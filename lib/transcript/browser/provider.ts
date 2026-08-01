import type {
  TranscriptListener,
  TranscriptProvider,
  TranscriptSession,
} from '@/lib/transcript/types'

/*
 * The browser's own recogniser: `SpeechRecognition`, as Chrome implements it.
 *
 * Free, and free in the way this project means it — there is no key, no account
 * and no request that lands on a bill. That is the entire reason it is here
 * rather than Whisper, and it is why `monthly_ceiling_usd` can stay at 0 with a
 * live transcript running.
 *
 * WHAT IT COSTS INSTEAD IS PRIVACY, and the honest way to hold that is to say it
 * on the screen. Chrome does not recognise speech on the device: it opens a
 * socket to Google and sends the audio. So a call transcribed here is a call
 * a third party heard, and `sendsAudioOffDevice` is true so the surface has to
 * print it above the button. That is the same disclosure the operator owes the
 * person on the line, which is why the consent row sits in the same place.
 *
 * IT IS NOT A LIBRARY, IT IS A DEVICE, and it behaves like one:
 *
 *   IT STOPS ON ITS OWN. `continuous` does not mean continuous — Chrome ends
 *   the session after a stretch of silence, which on a sales call is the other
 *   person thinking. So `onend` restarts it unless the operator asked for the
 *   stop, and the restart is invisible: the call is still going, so the surface
 *   must not blink to `stopped` and back.
 *
 *   IT DROPS THE SOCKET AFTER A FEW MINUTES, and this is the one that cost a
 *   call. Recognition does not happen in the browser: Chrome holds a connection
 *   to Google's service, and that connection does not survive a long call. What
 *   arrives is `error: 'network'` — somewhere around the five-minute mark, on a
 *   call that is going fine — and the first version of this file treated it as
 *   fatal. The session died, the surface said "press Start again", and the
 *   operator was mid-sentence and not looking at the screen. Everything after
 *   that point was lost, which on this product means the summary was written
 *   from the first five minutes of a twenty-minute conversation.
 *
 *   So `network` is now RECOVERABLE, not fatal. See `RECOVERABLE` below.
 *
 *   IT REVISES WHAT IT ALREADY SAID. Results arrive interim and are replaced,
 *   sometimes several times, which is why `TranscriptChunk` carries `final` and
 *   why only final chunks are ever written down.
 *
 *   IT REPORTS SILENCE AS AN ERROR. `no-speech` is not a fault; it is what a
 *   pause sounds like. Surfacing it would put a red line on the screen every
 *   time the operator listened, so it is swallowed and the restart handles it.
 *
 * German is fixed rather than configurable. The leads are German businesses,
 * `de-DE` is what the recogniser needs to be told, and a setting nobody would
 * ever change is a setting that can be got wrong.
 */

const LANGUAGE = 'de-DE'

/* ------------------------------------------------------------------------- *
 * The shape of an API TypeScript does not ship
 * ------------------------------------------------------------------------- */

/*
 * `lib.dom.d.ts` has no `SpeechRecognition`, because the spec never left draft.
 * Declared here, minimally — only the members this file touches — rather than
 * pulled in as a dependency: a package of ambient types for one class is a
 * package to keep updated, and `any` would put the one untyped surface in this
 * codebase at the point where the words arrive.
 */

interface SpeechRecognitionAlternative {
  readonly transcript: string
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

function constructorFor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  // Chrome and Edge still ship it prefixed; the unprefixed name is checked first
  // so this keeps working the day they stop.
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/* ------------------------------------------------------------------------- *
 * What went wrong, in words
 * ------------------------------------------------------------------------- */

/**
 * The recogniser's error codes, said the way the operator needs to hear them.
 *
 * He is mid-call when he reads this, so each one names the thing to do rather
 * than the thing that happened. `not-allowed` in particular: the fix is a
 * browser permission he has to grant himself, and "an error occurred" would
 * leave him looking at the wrong part of the screen.
 */
const MESSAGES: Record<string, string> = {
  'not-allowed':
    'Chrome is not allowing the microphone. Grant it in the address bar and press Start again.',
  'service-not-allowed':
    'Chrome refused the recognition service. Check that the page is on https or localhost.',
  'audio-capture': 'No microphone was found. Check that one is plugged in and selected in Chrome.',
  // No entry for `network`. It is recovered from rather than reported — see
  // `RECOVERABLE` — and the message it used to carry told the operator to press
  // a button the code now presses for him.
  aborted: 'Recognition was interrupted.',
  'language-not-supported': `This browser cannot recognise ${LANGUAGE}.`,
}

/**
 * Codes the operator never sees. Silence, and our own restarts.
 *
 * `no-speech` fires on any decent pause and `aborted` fires when we cycle the
 * session ourselves. Neither is a fault and neither counts against the recovery
 * budget below — a quiet call must not be able to exhaust it.
 */
const SILENT = new Set(['no-speech', 'aborted'])

/**
 * Codes that end the session but not the transcript.
 *
 * `network` is the whole reason this set exists. Chrome's recogniser is a socket
 * to Google, that socket does not survive a long call, and the failure arrives
 * as this code a few minutes in. It is not something the operator can act on and
 * it is not a reason to stop transcribing — it is a reconnect.
 *
 * Everything NOT in either set is genuinely fatal: a refused microphone, no
 * microphone, an unsupported language. Those need a person to do something, so
 * the surface says so once rather than looping.
 */
const RECOVERABLE = new Set(['network'])

/**
 * How hard to try before admitting the recogniser is gone.
 *
 * The counter is reset by any final result, so this is six failures IN A ROW
 * WITH NOTHING HEARD BETWEEN THEM — not six over a long call. A reconnect that
 * works and then transcribes a sentence has cost nothing and is forgotten.
 */
const MAX_CONSECUTIVE_RESTARTS = 6

/**
 * How long to wait before each retry, in milliseconds.
 *
 * The first one is a tick rather than zero on purpose: `start()` inside `onend`
 * throws `InvalidStateError` on Chrome often enough to matter, because the old
 * session has not finished tearing down in the same task. After that it backs
 * off — a service that just refused a connection will refuse the next one too,
 * and hammering it is how a transient outage becomes a dead session.
 *
 * The ceiling is four seconds. On a phone call four seconds is a sentence, which
 * is the most this is willing to lose while it reconnects.
 */
const RESTART_DELAYS_MS = [200, 400, 1_000, 2_000, 4_000, 4_000]

/* ------------------------------------------------------------------------- *
 * The provider
 * ------------------------------------------------------------------------- */

export class BrowserTranscriptProvider implements TranscriptProvider {
  readonly id = 'browser'
  readonly disclosure =
    'Chrome sends this call’s audio to Google to turn it into text. One microphone hears both sides, so no line is attributed to a speaker.'
  readonly sendsAudioOffDevice = true

  isAvailable(): boolean {
    return constructorFor() !== null
  }

  start(listener: TranscriptListener): TranscriptSession {
    const Recognition = constructorFor()

    if (!Recognition) {
      listener.onError(
        'This browser has no speech recognition. Chrome or Edge can do it; Firefox and Safari cannot.',
      )
      listener.onStatus('error')
      return { stop: () => {} }
    }

    const recognition = new Recognition()
    recognition.lang = LANGUAGE
    recognition.continuous = true
    recognition.interimResults = true
    // One guess. The alternatives are for a UI that offers corrections, and this
    // one has an operator on the phone rather than a proof-reader.
    recognition.maxAlternatives = 1

    /*
     * `atMs` is measured from here — the press — and the surface aligns
     * `calls.started_at` with the same moment. `performance.now()` rather than
     * `Date.now()` because it cannot go backwards: a clock correction mid-call
     * would otherwise write segments that appear to precede ones already stored.
     */
    const origin = performance.now()
    const now = () => Math.round(performance.now() - origin)

    /** Set when the operator pressed stop, so `onend` knows not to resurrect it. */
    let closing = false
    /** Set when an error ended the session for good. Suppresses the restart too. */
    let failed = false
    /**
     * Restarts since the last thing anybody said.
     *
     * Reset by a final result, which is the only proof that a session is
     * actually working. That is what makes the budget mean "it is broken" rather
     * than "this has been a long call".
     */
    let consecutiveRestarts = 0
    /** The pending restart, so stopping cancels it instead of racing it. */
    let restartTimer: ReturnType<typeof setTimeout> | null = null

    function giveUp(message: string) {
      failed = true
      listener.onError(message)
      listener.onStatus('error')
    }

    recognition.onstart = () => {
      if (!closing && !failed) listener.onStatus('listening')
    }

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result[0]?.transcript?.trim()
        if (!text) continue

        // Words arrived, so whatever went wrong before is over. Anything less
        // than a final result may be the recogniser thinking out loud.
        if (result.isFinal) consecutiveRestarts = 0

        listener.onChunk({
          atMs: now(),
          // One microphone, one room. See `TranscriptChunk.speaker`.
          speaker: 'unknown',
          text,
          final: result.isFinal,
        })
      }
    }

    recognition.onerror = (event) => {
      // Silence, and our own cycling. Never shown, never counted.
      if (SILENT.has(event.error)) return

      /*
       * A dropped connection is a reconnect, not a stop. `onend` follows this
       * event and does the actual work; all this has to do is not kill the
       * session on the way past. The operator is told nothing, because there is
       * nothing for him to do and he is on the phone.
       */
      if (RECOVERABLE.has(event.error)) return

      giveUp(MESSAGES[event.error] ?? `The recogniser stopped: ${event.message || event.error}.`)
    }

    /*
     * The restart. Two different things end a session and both land here.
     *
     * Chrome ends it on silence — a sales call is mostly silence from this
     * microphone's point of view, the other person talking and the operator
     * listening — and Chrome ends it again a few minutes in when the socket to
     * the recognition service drops. Neither is a reason to stop transcribing a
     * call that is still happening.
     *
     * Deferred rather than immediate: `start()` throws `InvalidStateError` if
     * the previous session has not finished tearing down, which in the same task
     * it has not. That throw used to become a dead recogniser under a surface
     * still drawing "listening".
     *
     * The status is deliberately NOT moved during a restart. The call is still
     * going, and a readout that blinked to `stopped` and back every time the
     * other person paused would be a readout the operator learns to ignore.
     */
    recognition.onend = () => {
      if (closing || failed) {
        listener.onStatus('stopped')
        return
      }

      if (consecutiveRestarts >= MAX_CONSECUTIVE_RESTARTS) {
        giveUp(
          'The recogniser lost its connection to Google and could not get it back. ' +
            'The call is still going and everything up to now is saved — press Start again.',
        )
        return
      }

      const delay =
        RESTART_DELAYS_MS[Math.min(consecutiveRestarts, RESTART_DELAYS_MS.length - 1)]
      consecutiveRestarts += 1

      restartTimer = setTimeout(() => {
        restartTimer = null
        if (closing || failed) return

        try {
          recognition.start()
        } catch {
          /*
           * Not fatal on its own. The session may simply not have let go yet, and
           * `onend` will fire again — or the budget above will run out and say so
           * properly. Giving up on the first refused restart is what turned a
           * hiccup into a lost transcript.
           */
          listener.onStatus('listening')
        }
      }, delay)
    }

    listener.onStatus('starting')
    try {
      recognition.start()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Speech recognition would not start.'
      giveUp(message)
    }

    return {
      stop: () => {
        closing = true
        if (restartTimer !== null) {
          clearTimeout(restartTimer)
          restartTimer = null
        }
        // `stop()` rather than `abort()`: it lets the recogniser deliver the
        // sentence it is holding, which is usually the last thing said before
        // the operator reached for the button.
        recognition.stop()
      },
    }
  }
}

export const BROWSER_TRANSCRIPT_PROVIDER = new BrowserTranscriptProvider()
