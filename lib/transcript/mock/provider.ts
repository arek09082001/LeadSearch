import { SPEAKERPHONE_CALL, type FixtureLine } from '@/lib/transcript/fixtures/speakerphone'
import type {
  TranscriptChunk,
  TranscriptListener,
  TranscriptProvider,
  TranscriptSession,
} from '@/lib/transcript/types'

/*
 * A recorded call, played back on a clock.
 *
 * This is how the whole chain gets tested — surface, batching, route, rows —
 * without anybody speaking, and identically every time. Talking into a
 * microphone to check that a POST fires is a test that takes two minutes, needs
 * a quiet room, and gives a different answer each run.
 *
 * IT IS DELIBERATELY NOT INSTANT. Every line arrives at the second the fixture
 * says, growing word by word first, exactly as the browser delivers it. A mock
 * that dumped sixteen finished sentences on mount would let a middle column be
 * built that cannot survive its own scroll behaviour, and would never once
 * exercise the interim path — which is the part of this surface most likely to
 * flicker.
 *
 * IT EMITS `unknown` LIKE THE REAL ONE. The fixture knows who is speaking and
 * refuses to say. See the note on `FixtureLine.speakerHint`.
 */

/** How often an unfinished line is revised. Roughly Chrome's own cadence. */
const INTERIM_MS = 380

/**
 * How long before a line lands the recogniser starts guessing at it.
 *
 * The interim window: text appears, grows, and is replaced by the final version.
 * Two and a half seconds is about what a spoken sentence takes, and the surface
 * has to look right for all of it.
 */
const INTERIM_LEAD_MS = 2_500

/**
 * The pause the real one takes asking Chrome for the microphone.
 *
 * Also the floor for the first word: a fixture line early enough that its
 * interim window opens before this would have the provider emitting speech it
 * has not yet claimed to be listening for, which is a state the real recogniser
 * cannot be in and the surface should therefore never have to render.
 */
const OPEN_MS = 600

/** Words revealed for a line that is `progress` of the way through its window. */
function partial(text: string, progress: number): string {
  const words = text.split(' ')
  // At least one word, and never the whole line — the last word is what the
  // final chunk is for, and an interim that already matched it would make the
  // hand-off invisible in exactly the case it needs checking.
  const count = Math.max(1, Math.min(words.length - 1, Math.round(words.length * progress)))
  return words.slice(0, count).join(' ')
}

export class MockTranscriptProvider implements TranscriptProvider {
  readonly id = 'mock'
  readonly disclosure =
    'Fixture playback. No microphone is opened and no audio leaves this machine — you are watching a recorded call.'
  readonly sendsAudioOffDevice = false

  private readonly lines: readonly FixtureLine[]

  constructor(lines: readonly FixtureLine[] = SPEAKERPHONE_CALL) {
    this.lines = lines
  }

  /** Always. A fixture needs nothing from the browser. */
  isAvailable(): boolean {
    return true
  }

  start(listener: TranscriptListener): TranscriptSession {
    const timers: ReturnType<typeof setTimeout>[] = []
    let stopped = false

    const at = (delayMs: number, run: () => void) => {
      // Negative delays happen when a fixture line sits inside the opening
      // interim window; setTimeout treats them as 0, which is what we want.
      timers.push(setTimeout(run, Math.max(0, delayMs)))
    }

    const emit = (chunk: TranscriptChunk) => {
      if (!stopped) listener.onChunk(chunk)
    }

    // The pause the real one takes asking for the microphone. Kept, so the
    // surface's `starting` state is exercised by the fixture too.
    at(0, () => listener.onStatus('starting'))
    at(OPEN_MS, () => {
      if (!stopped) listener.onStatus('listening')
    })

    for (const line of this.lines) {
      const opensAt = line.atMs - INTERIM_LEAD_MS

      for (let tick = INTERIM_MS; tick < INTERIM_LEAD_MS; tick += INTERIM_MS) {
        // Nothing is heard before the microphone is open. Without this floor a
        // fixture line in the first two and a half seconds emits text during
        // `starting`, which is a sequence the browser never produces.
        if (opensAt + tick < OPEN_MS) continue

        at(opensAt + tick, () =>
          emit({
            atMs: opensAt + tick,
            speaker: 'unknown',
            text: partial(line.text, tick / INTERIM_LEAD_MS),
            final: false,
          }),
        )
      }

      at(line.atMs, () =>
        emit({ atMs: line.atMs, speaker: 'unknown', text: line.text, final: true }),
      )
    }

    /*
     * The fixture runs out, and says so. A real call ends when somebody hangs
     * up and the operator presses stop; this one ends on its own, and going
     * quiet without a status change would look like a recogniser that had
     * silently died — which is a different thing and has a different fix.
     */
    const last = this.lines.length ? this.lines[this.lines.length - 1].atMs : 0
    at(last + 1_500, () => {
      if (!stopped) listener.onStatus('stopped')
    })

    return {
      stop: () => {
        stopped = true
        for (const timer of timers) clearTimeout(timer)
        listener.onStatus('stopped')
      },
    }
  }
}

export const MOCK_TRANSCRIPT_PROVIDER = new MockTranscriptProvider()
