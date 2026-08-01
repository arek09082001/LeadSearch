import 'server-only'

import { getBriefingProvider } from '@/lib/assistant'
import { buildBriefingInput } from '@/lib/assistant/briefing-input'
import { readCachedReviews, writeBriefing, writeReviews } from '@/lib/assistant/store'
import type { CachedReviews } from '@/lib/assistant/store'
import type { StoredBriefing } from '@/lib/assistant/types'
import { readLeadDetail } from '@/lib/leads/repository'
import { getReviewProvider } from '@/lib/providers'
import { BudgetExceededError, ProviderError } from '@/lib/providers/types'
import { SpendGuard } from '@/lib/search/cost'

/*
 * Preparing one call: gather, ask, write down.
 *
 * The whole pass is one lead and one moment. It is not a queue, it is not
 * batched, and it has no cadence — the operator pressed a button because he is
 * about to dial, and everything here happens between that press and the page
 * redrawing.
 *
 * IT CAN SPEND MONEY, once, and only on reviews. Google prices a Places request
 * at its most expensive field and `reviews` sits in the top band, which is the
 * entire reason that call is here and not in the enrichment pass — see
 * `lib/providers/google-places/reviews.ts`. So it goes through the same
 * SpendGuard a search does, against the same ceiling, and lands in the same
 * ledger.
 *
 * A REFUSED OR FAILED REVIEW FETCH DOES NOT FAIL THE BRIEFING. That is the one
 * judgement in this file worth arguing with, so: the diagnosis is what the call
 * is built on, and reviews are colour on top of it. A ceiling that stopped the
 * operator preparing a call at all would be a cost control that had started
 * costing him work — and the briefing says out loud that it was written without
 * them, which is the honest form of degrading.
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
 * The review set for a place: from cache when there is a live one, from Google
 * otherwise, and null when Google could not be asked.
 *
 * Null is deliberately not an empty array. "This business has no reviews" is
 * something to say on a call; "we could not find out" is something to not say.
 */
async function loadReviews(
  googlePlaceId: string,
  guard: SpendGuard,
): Promise<{ reviews: CachedReviews | null; error: string | null; cached: boolean }> {
  const cached = await readCachedReviews(googlePlaceId)
  if (cached) return { reviews: cached, error: null, cached: true }

  try {
    const provider = getReviewProvider()
    const { reviews } = await provider.getReviews(googlePlaceId, guard)
    return { reviews: await writeReviews(googlePlaceId, reviews), error: null, cached: false }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { reviews: null, error: error.message, cached: false }
    }
    if (error instanceof ProviderError) {
      return { reviews: null, error: error.message, cached: false }
    }

    // Anything else is a bug in this pass rather than a refusal from Google, and
    // it still must not cost the operator his briefing.
    const message = error instanceof Error ? error.message : 'The reviews could not be fetched.'
    console.error('[assistant] review fetch failed', { googlePlaceId, message })
    return { reviews: null, error: message, cached: false }
  }
}

export async function prepareBriefing(leadId: string): Promise<PreparedBriefing> {
  const detail = await readLeadDetail(leadId)
  if (!detail) throw new Error('That lead is not in the book.')

  const { lead, audit, score, timeline } = detail

  /*
   * The guard is created before anything is asked for, and it reads the ledger
   * once. One lead, one possible request — but the guard is what makes that
   * request refusable, and a pass that spends first and checks afterwards is a
   * receipt rather than a limit.
   */
  const guard = await SpendGuard.create()
  const reviews = await loadReviews(lead.googlePlaceId, guard)

  const input = buildBriefingInput({
    lead,
    audit,
    score,
    timeline,
    reviews: reviews.reviews,
  })

  const provider = getBriefingProvider()
  const { briefing } = await provider.prepare(input, guard)

  const stored = await writeBriefing({
    leadId: lead.id,
    auditId: audit?.id ?? null,
    scoreId: score?.id ?? null,
    provider: provider.id,
    model: provider.model,
    input,
    briefing,
  })

  return { briefing: stored, reviewsError: reviews.error, reviewsCached: reviews.cached }
}
