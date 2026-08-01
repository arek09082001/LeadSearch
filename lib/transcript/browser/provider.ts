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
  network: 'The recogniser lost its connection to Google. The call is still going; press Start again.',
  aborted: 'Recognition was interrupted.',
  'language-not-supported': `This browser cannot recognise ${LANGUAGE}.`,
}

/**
 * Codes that mean "try again" versus codes that mean "stop and tell him".
 *
 * `no-speech` fires on any decent pause and `aborted` fires on our own restart,
 * so both are noise. Everything else has ended the session for a reason the
 * operator can act on, and the surface should say so once rather than loop.
 */
const HARMLESS = new Set(['no-speech', 'aborted'])

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

    recognition.onstart = () => {
      if (!closing && !failed) listener.onStatus('listening')
    }

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result[0]?.transcript?.trim()
        if (!text) continue

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
      if (HARMLESS.has(event.error)) return

      failed = true
      listener.onError(
        MESSAGES[event.error] ?? `The recogniser stopped: ${event.message || event.error}.`,
      )
      listener.onStatus('error')
    }

    /*
     * The restart. Chrome ends the session on silence, and a sales call is
     * mostly silence from this microphone's point of view — the other person
     * talking, the operator listening. Without this the transcript stops
     * somewhere in the first minute and nothing says why.
     *
     * `start()` throws if the session is somehow already running, and that throw
     * must not escape into an event handler: it would leave the call with a dead
     * recogniser and a surface still drawing "listening".
     */
    recognition.onend = () => {
      if (closing || failed) {
        listener.onStatus('stopped')
        return
      }

      try {
        recognition.start()
      } catch {
        failed = true
        listener.onError('The recogniser stopped and would not restart. Press Start again.')
        listener.onStatus('error')
      }
    }

    listener.onStatus('starting')
    try {
      recognition.start()
    } catch (error) {
      failed = true
      const message = error instanceof Error ? error.message : 'Speech recognition would not start.'
      listener.onError(message)
      listener.onStatus('error')
    }

    return {
      stop: () => {
        closing = true
        // `stop()` rather than `abort()`: it lets the recogniser deliver the
        // sentence it is holding, which is usually the last thing said before
        // the operator reached for the button.
        recognition.stop()
      },
    }
  }
}

export const BROWSER_TRANSCRIPT_PROVIDER = new BrowserTranscriptProvider()
