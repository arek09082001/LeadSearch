import 'server-only'

import { getAssistant } from '@/lib/assistant'
import { leadOf } from '@/lib/assistant/briefing-input'
import { readCall, readLatestSummary, readSegments, writeSummary } from '@/lib/assistant/store'
import type { NoSummaryReason, StoredSummary } from '@/lib/assistant/types'
import { dateFrom } from '@/lib/leads/dates'
import { readLead } from '@/lib/leads/repository'

/*
 * Writing up one call, from the words while they are still there.
 *
 * The counterpart to `run.ts`, and shorter than it for a reason worth naming:
 * preparing a briefing gathers a lead from six tables, may spend money, and has
 * to decide what a provider is allowed to know. This gathers a transcript. The
 * summary is handed the words and the lead and nothing else — no diagnosis, no
 * findings, no reviews — because what was found matters far less afterwards than
 * what was said, and a summary that argued from the audit would be writing up
 * the call the operator was supposed to have rather than the one he had.
 *
 * IT RUNS AGAINST A CLOCK IT DOES NOT SET. `call_transcript_segments` expires
 * after fourteen days and the deletion is scheduled inside Postgres, so it
 * happens whether or not this app is running. The summary is therefore not a
 * thing that can be got round to: it is the only record that survives the
 * fortnight, and the window in which it can be written at all closes on its own.
 * Which is why the surface fires this on Stop rather than on a nightly pass —
 * see the route.
 *
 * IT REFUSES TO INVENT ONE. A call with no segments left gets a named reason
 * back and no provider is asked. That is the single most important line in this
 * file: a model handed an empty transcript will write a plausible paragraph
 * about a conversation nobody has a record of, and that paragraph would then be
 * the permanent record of what was said. `NoSummaryReason` exists so the surface
 * can say which kind of nothing it is looking at.
 */

/**
 * The window the schema enforces, restated so this file can reason about it.
 *
 * Stated twice for the reason `REVIEW_RETENTION_DAYS` is: the number belongs to
 * the migration and is applied by a column default there, and a caller cannot
 * read a default. If the two ever disagree the cost is a wrong sentence on
 * screen rather than a wrong row — this copy is only ever used to explain an
 * absence, never to cause one.
 */
const TRANSCRIPT_RETENTION_DAYS = 14

/** The summary, or the honest reason there is not one. Never both, never neither. */
export type SummaryResult =
  | { summary: StoredSummary; reason: null }
  | { summary: null; reason: NoSummaryReason }

/**
 * Which kind of nothing.
 *
 * NAMES ONLY WHAT CAN BE ASSERTED. Inside the retention window the answer is
 * certain: the segments would still be here, so nobody pressed Start and there
 * were never any words. Outside it the two cases are genuinely indistinguishable
 * — a call that was never transcribed and one whose transcript has been deleted
 * look identical, by design, because the deletion leaves nothing behind. So an
 * old call is reported as expired, which is the reading that is true of the
 * thing the operator can still do about it: nothing.
 */
function reasonFor(call: { startedAt: string; endedAt: string | null }): NoSummaryReason {
  const ended = new Date(call.endedAt ?? call.startedAt).getTime()
  const age = Date.now() - ended
  return age > TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ? 'transcript_expired'
    : 'no_transcript'
}

export async function summariseCall(
  callId: string,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const call = await readCall(callId)
  if (!call) throw new Error('That call is not in the book.')

  /*
   * A call still in progress is not a call to write up.
   *
   * The brief for this route is that the summary is triggered by pressing Stop,
   * and this is the half of that promise the server keeps. A summary of a
   * conversation that is still happening would be written from the first half of
   * it and would be wrong by the time it appeared — and worse, it would appear
   * on screen during the second half.
   */
  if (!call.endedAt) throw new Error('That call has not been closed off yet.')

  const [lead, transcript] = await Promise.all([readLead(call.leadId), readSegments(call.id)])
  if (!lead) throw new Error('That lead is not in the book.')

  if (!transcript.length) return { summary: null, reason: reasonFor(call) }

  const assistant = getAssistant()
  // `leadOf` rather than a second narrowing of the row. There is one answer to
  // what the assistant knows about a business and it is the one the briefing
  // used; see the note on that function.
  const summary = await assistant.summary.summarise(transcript, leadOf(lead), {
    signal,
    callId: call.id,
  })

  /*
   * The offset becomes a day, here, once.
   *
   * Anchored on the end of the call rather than on now — which is the same thing
   * to within a second on the Stop path, and is not the same thing at all when a
   * summary is written up the following morning. The day that gets stored is the
   * day that was agreed on the phone; see `dateFrom`.
   */
  const suggestedFollowUpAt =
    summary.suggestedFollowUpDays === null
      ? null
      : dateFrom(call.endedAt, summary.suggestedFollowUpDays)

  const stored = await writeSummary({
    callId: call.id,
    provider: assistant.id,
    model: summary.origin.model,
    body: summary.body,
    suggestedStatus: summary.suggestedStatus,
    suggestedNextAction: summary.suggestedNextAction,
    suggestedFollowUpAt,
  })

  return { summary: stored, reason: null }
}

/**
 * The summary this call already has, or a fresh one.
 *
 * The Stop path fires once and a reload does not fire it again, so this exists
 * for the press that arrives twice — a double-click, a retried request, a tab
 * that came back. Regenerating is allowed and deliberate (a second row is how
 * `call_summaries` records that the first one missed), but it must be asked for
 * rather than fallen into.
 */
export async function summariseCallOnce(
  callId: string,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const existing = await readLatestSummary(callId)
  if (existing) return { summary: existing, reason: null }
  return summariseCall(callId, signal)
}
