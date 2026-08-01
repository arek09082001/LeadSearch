import type { FixtureTip } from '@/lib/assistant/fixtures/types'

/*
 * The two tips that have nothing to do with who is on the phone.
 *
 * Every other tip is a reaction to something said, which is why it lives in the
 * fixture for the call type that provokes it. These two are reactions to the
 * CALL itself — how long it has been running, and whether consent to transcribe
 * was ever marked — and they would be identical in all four fixtures. Copied
 * four times, they would drift, and the one that drifted would be the consent
 * one nobody re-read.
 *
 * `cues` is empty on both: they are not recognised from the transcript. The mock
 * fires them off the clock, which is also how the real provider will have to —
 * a model reading the last minute of conversation has no way to know that
 * consent was never marked, and that is precisely the case worth catching.
 */

/**
 * Consent, and it comes first when it fires.
 *
 * The only tip in the system that is about the operator's exposure rather than
 * the sale. It outranks everything because a transcript of a stranger's voice
 * recorded without a word said about it is the one mistake on this screen that
 * cannot be undone afterwards — `call_transcript_segments` is deleted on a
 * fortnight's clock precisely because of what it holds, and a deletion schedule
 * is not a substitute for having asked.
 */
export const CONSENT_TIP: FixtureTip = {
  trigger: 'consent_not_noted',
  cues: [],
  body: 'Consent not marked. Say it is being transcribed, then tap the button.',
}

/**
 * The clock. Fires late and once.
 *
 * A first cold call has agreed something by minute twelve or it is being
 * endured, and the operator in the middle of it is the last person able to
 * notice which.
 */
export const LONG_CALL_TIP: FixtureTip = {
  trigger: 'call_running_long',
  cues: [],
  body: 'Twelve minutes. Agree the next step or end it.',
}
