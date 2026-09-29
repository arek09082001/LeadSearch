import type { Speaker } from '@/lib/assistant/types'

/*
 * The transcript boundary.
 *
 * The call surface is written against this file and never against
 * `SpeechRecognition`. Today there are two implementations — the browser's own
 * recogniser and a fixture that plays a recorded conversation on a timer — and
 * a third (Whisper, or whatever replaces it) has to be able to sit beside them
 * without the surface noticing.
 *
 * DELIBERATELY NOT `server-only`, and deliberately not the shape of the
 * assistant boundary next door. `BriefingProvider.generate()` is a request and a
 * response; a recogniser is a tap that runs for eleven minutes and pushes. So
 * this is a listener interface rather than a promise, and every implementation
 * of it runs in the browser — the audio never reaches a route handler, which is
 * the one property that keeps this free.
 *
 * THREE THINGS THIS INTERFACE INSISTS ON, because all three are properties of
 * the real recogniser that a mock would otherwise let the surface forget.
 *
 *  1. INTERIM RESULTS EXIST AND ARE NOT FACTS. The browser revises its guess
 *     mid-word — "Vielen Dank" becomes "Vielen Dank für den Anruf" becomes
 *     something else again — so a chunk carries `final`, and only a final chunk
 *     is worth a row. A surface built against a provider that only ever emitted
 *     finished sentences would flicker the moment it met a real one.
 *
 *  2. SPEECH FAILS WHILE IT IS RUNNING. The microphone is refused, the network
 *     drops, Chrome stops the stream after a silence. Those are `onError` and
 *     `onStatus`, not a rejected promise, because they happen at minute six of
 *     a call that is still going.
 *
 *  3. THE PROVIDER DECLARES WHERE THE AUDIO GOES. `sendsAudioOffDevice` is on
 *     the interface rather than in a README because the answer differs per
 *     implementation and the operator is entitled to read it on the screen he
 *     is about to speak into. See `ConsentNotice`.
 */

/**
 * What the recogniser is doing, as the button and the indicator draw it.
 *
 * `starting` is its own state and not a flourish: the browser shows a permission
 * prompt between the press and the first word, and a button that already said
 * "listening" during it would be lying for as long as the operator took to
 * click Allow.
 */
export type TranscriptStatus = 'idle' | 'starting' | 'listening' | 'stopped' | 'error'

/**
 * One piece of recognised speech.
 *
 * `atMs` is milliseconds since `start()` was called, which the surface aligns
 * with `calls.started_at` — see the listen route for why that column is stamped
 * at the press rather than at prepare. The provider counts from its own start
 * because it is the only thing that knows when it actually began hearing.
 */
export interface TranscriptChunk {
  atMs: number
  /**
   * Always `unknown` from a microphone pointed at a speakerphone, and that is
   * not a limitation to be worked around later.
   *
   * One microphone hears one room. Both halves of the conversation arrive as a
   * single stream, and nothing in the browser separates them — so the honest
   * value is the one the schema's check constraint already allows, and a
   * provider that guessed 'business' would be putting an invention in a column
   * that gets read back as fact. Diarisation is a property of a provider that
   * has it; the interface leaves room for one without pretending to be it.
   */
  speaker: Speaker
  text: string
  /**
   * False while the recogniser is still revising. Drawn, never stored.
   *
   * The surface shows interim text because eleven seconds of nothing looks
   * broken, and discards it because a database of retracted guesses is worse
   * than no database.
   */
  final: boolean
}

export interface TranscriptListener {
  onChunk(chunk: TranscriptChunk): void
  onStatus(status: TranscriptStatus): void
  /** Named and human. It goes on screen during a call, so it has to read as a sentence. */
  onError(message: string): void
}

/**
 * A run of listening. The only thing you can do to it is end it.
 *
 * Returned rather than exposed as `provider.stop()` because two sessions must
 * not be able to fight over one provider instance: whoever holds the session
 * holds the microphone.
 */
export interface TranscriptSession {
  stop(): void
}

export interface TranscriptProvider {
  /** Registry id: `browser`, `mock`. Rendered on the surface, alongside the disclosure. */
  readonly id: string
  /** One line, on screen. What this thing is and where the sound goes. */
  readonly disclosure: string
  /**
   * Whether audio leaves the machine to be recognised.
   *
   * True for the browser recogniser — Chrome sends the stream to Google — and
   * the surface is required to say so above the start button. It is the same
   * disclosure the operator owes the person on the other end of the line, and
   * the reason it is a field rather than a comment is that a future on-device
   * provider will answer differently and the notice must change with it.
   */
  readonly sendsAudioOffDevice: boolean
  /**
   * Whether this build can listen here, checked before the button is drawn.
   *
   * Firefox has no `SpeechRecognition` at all. That is a fact about the browser
   * the operator is holding, and it has to become a sentence on the page rather
   * than a button that does nothing when pressed.
   */
  isAvailable(): boolean
  start(listener: TranscriptListener): TranscriptSession
}
