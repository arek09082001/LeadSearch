import 'server-only'

import { getAssistant } from '@/lib/assistant'
import { buildBriefingInput } from '@/lib/assistant/briefing-input'
import {
  readCachedReviews,
  readNewestSummary,
  readPreviousCalls,
  startCall,
  writeBriefing,
  writeReviews,
} from '@/lib/assistant/store'
import type { CachedReviews } from '@/lib/assistant/store'
import type { StoredBriefing } from '@/lib/assistant/types'
import { Deadline, capped } from '@/lib/deadline'
import { readLeadDetail } from '@/lib/leads/repository'
import { getReviewProvider } from '@/lib/providers'
import { BudgetExceededError, ProviderError } from '@/lib/providers/types'
import { SpendGuard } from '@/lib/search/cost'

/*
 * Preparing one call: open the attempt, gather, ask, write it down.
 *
 * One lead and one moment. Not a queue, not batched, no cadence — the operator
 * pressed a button because he is about to dial, and everything here happens
 * between that press and the page redrawing.
 *
 * IT OPENS A `calls` ROW, and that is the decision in this file most worth
 * arguing with. `calls` records attempts rather than conversations, and pressing
 * prepare is the moment the operator has decided to ring — the row is what
 * `call_briefings.call_id` hangs off, what the tip provider will write against,
 * and what `leads.latest_call_id` starts pointing at. The cost of being wrong is
 * an attempt logged for a call that never happened; the cost of the alternative
 * is a briefing with nowhere to live. `calls.outcome` is free text and exists to
 * record exactly that kind of ending.
 *
 * IT CAN SPEND MONEY, once, and only on reviews. `reviews` is an Enterprise +
 * Atmosphere field and Places bills a request at its most expensive field, which
 * is why that call is here rather than in the enrichment pass. So it goes
 * through the same SpendGuard a search does, against the same ceiling, and lands
 * in the same ledger.
 *
 * A REFUSED OR FAILED REVIEW FETCH DOES NOT FAIL THE BRIEFING, and neither does
 * a refused assistant. `types.ts` states the rule for the second — none of the
 * three interfaces is load-bearing, and a call with no briefing is a cold call —
 * and the first follows the same logic: the diagnosis is what the call is built
 * on, and reviews are colour on top of it. A ceiling that stopped the operator
 * preparing a call at all would be a cost control that had started costing him
 * work.
 */

/** The briefing, and how it got there. Returned so the route can say what happened. */
export interface PreparedBriefing {
  briefing: StoredBriefing
  /** Set when reviews could not be fetched. Named, never "something went wrong". */
  reviewsError: string | null
  /** True when the reviews came from cache rather than from a billable request. */
  reviewsCached: boolean
}

/**
 * How long the reviews may take before the briefing goes ahead without them.
 *
 * Its own cap rather than a share of the request's, because these two are not
 * the same kind of thing: the briefing is what the operator pressed the button
 * for and the reviews are colour on top of it. Eight seconds is long enough for
 * Google on a bad day and short enough that a Google which has stopped answering
 * altogether costs a sentence on screen rather than the whole call.
 */
const REVIEWS_BUDGET_MS = 8_000

/**
 * The review set for a place: from cache when there is a live one, from Google
 * otherwise, and null when Google could not be asked.
 *
 * Null is deliberately not an empty array. "This business has no reviews" is
 * something to say on a call; "we could not find out" is something to not say.
 */
async function loadReviews(
  googlePlaceId: string,
  guard: SpendGuard,
  deadline: Deadline | undefined,
): Promise<{ reviews: CachedReviews | null; error: string | null; cached: boolean }> {
  const cached = await readCachedReviews(googlePlaceId)
  if (cached) return { reviews: cached, error: null, cached: true }

  /*
   * The context is assembled here rather than being the guard itself, exactly as
   * `lib/search/run.ts` assembles it: the guard owns money, the signal owns the
   * connection, and neither should have to know about the other. Passing the
   * guard straight through — which is what this did — meant `ctx.signal` was
   * always undefined and this fetch had no time limit of any kind.
   */
  const leg = capped(deadline, REVIEWS_BUDGET_MS, 'Google')

  try {
    const provider = getReviewProvider()
    const { reviews } = await provider.getReviews(googlePlaceId, {
      signal: leg.signal,
      authorizeSpend: guard.authorizeSpend,
      recordSpend: guard.recordSpend,
    })
    return { reviews: await writeReviews(googlePlaceId, reviews), error: null, cached: false }
  } catch (error) {
    /*
     * The one failure this leg may not absorb is the whole request running out
     * of time. Everything else here degrades into a note beside the briefing;
     * this would degrade into carrying on to a model call with no budget left to
     * make it with, and the operator would wait out the rest of the minute for
     * an answer that could not arrive.
     */
    if (deadline?.expired) throw error

    if (error instanceof BudgetExceededError || error instanceof ProviderError) {
      return { reviews: null, error: error.message, cached: false }
    }

    // Anything else is a bug in this pass rather than a refusal from Google, and
    // it still must not cost the operator his briefing.
    const message = error instanceof Error ? error.message : 'The reviews could not be fetched.'
    console.error('[assistant] review fetch failed', { googlePlaceId, message })
    return { reviews: null, error: message, cached: false }
  } finally {
    leg.release()
  }
}

export async function prepareBriefing(
  leadId: string,
  deadline?: Deadline,
): Promise<PreparedBriefing> {
  const detail = await readLeadDetail(leadId)
  if (!detail) throw new Error('That lead is not in the book.')

  const { lead, audit, score, timeline } = detail

  const call = await startCall(lead.id, lead.status)

  /*
   * The guard is created before anything is asked for, and it reads the ledger
   * once. One lead, one possible request — but the guard is what makes that
   * request refusable, and a pass that spends first and checks afterwards is a
   * receipt rather than a limit.
   */
  const guard = await SpendGuard.create(null, call.id)

  const [reviews, previousCalls] = await Promise.all([
    loadReviews(lead.googlePlaceId, guard, deadline),
    // Excluding the row just opened: it is this call, not a previous one, and
    // counting it would tell the assistant the operator has rung once more than
    // he has.
    readPreviousCalls(lead.id, call.id),
  ])

  /*
   * What was said last time, if there was a last time.
   *
   * SEQUENTIAL RATHER THAN IN THE `Promise.all` ABOVE, because it needs the call
   * ids that pass produces. One extra round trip on a path the operator is
   * already waiting on — and it buys the one input that keeps a fourth call from
   * opening like a first. Skipped without a query when the lead is cold, which
   * is most leads.
   *
   * NOT FILTERED ON `accepted`. That column says whether he agreed with the
   * suggestions, not whether the conversation happened; see the note on
   * `BriefingHistory.lastSummary`.
   */
  const lastSummary = await readNewestSummary(previousCalls.map((call) => call.id))

  const input = buildBriefingInput({
    lead,
    audit,
    score,
    timeline,
    previousCalls,
    lastSummary,
    reviews: reviews.reviews,
  })

  const assistant = getAssistant()
  /*
   * `callId` so a model-backed provider can file its tokens against the attempt
   * this briefing was written for; `deadline` so it can size its own request
   * against what is left of the operator's minute rather than against a constant
   * written when the route allowed thirty seconds. See `AssistantContext`.
   */
  const briefing = await assistant.briefing.generate(input, {
    signal: deadline?.signal,
    deadline,
    callId: call.id,
  })

  const stored = await writeBriefing({
    callId: call.id,
    provider: assistant.id,
    model: briefing.origin.model,
    briefing,
    diagnosisAsOf: input.measurements.auditedAt,
    reviewCount: input.reviews === null ? null : input.reviews.length,
  })

  return { briefing: stored, reviewsError: reviews.error, reviewsCached: reviews.cached }
}
