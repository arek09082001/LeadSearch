import type { WeaknessSignal } from '@/lib/services/site-check'

/*
 * The storage rule's vocabulary: what a lead can be, why one was thrown away,
 * and the four numbers the rule turns on.
 *
 * Not `server-only`, and that is load-bearing twice over. The tool schemas
 * advertise these defaults to the assistant, and `scripts/site-check-demo.mjs`
 * runs the rule from a terminal — neither can import a module the server owns.
 *
 * ONE PLACE FOR THE THRESHOLDS. Every number below is a judgement the operator
 * is entitled to change, and each is written once so changing his mind is an
 * edit rather than an archaeology exercise.
 */

/** Why a business is in the book. Mirrors the `public.lead_type` enum exactly. */
export type LeadType = 'no_website' | 'weak_website' | 'manual'

/**
 * Why a business was not.
 *
 * A closed list in the code over a free-text column in the database, which is
 * the same split the audit draws: the schema stays open so a new reason costs
 * no migration, and the code stays closed so a typo is a type error rather than
 * a category that quietly appears in the counts one day.
 *
 * The order is the order the rule applies them, and it is not arbitrary — each
 * is cheaper than the one below it. `alreadyKnown` is one index lookup;
 * `hasGoodWebsite` is an eight-second request to somebody's server. A rule that
 * asked them in the other order would be correct and would cost a fortune.
 */
export const SKIP_REASONS = [
  /** Already a lead, or already rejected once. Costs nothing to reject again. */
  'alreadyKnown',
  /** Google says closed, closed temporarily, or anything that is not OPERATIONAL. */
  'notOperational',
  /** Neither a phone number nor an address. There is nobody to call and nowhere to go. */
  'noContact',
  /** Under the hard floor of 5 ratings. Too little to judge a business on. */
  'tooFewReviews',
  /** Under the hard floor of 3.5 stars. */
  'ratingTooLow',
  /**
   * Has a website, and not enough standing to be worth a check.
   *
   * Distinct from `tooFewReviews` on purpose. That one says the business is
   * unjudgeable; this one says it is judgeable and does not clear the bar the
   * operator set for spending a request on it — `minReviewCount` and
   * `minRating`, both of which he can lower per call.
   */
  'belowPreselection',
  /** Checked, and the site was fine. The expensive answer, and the common one. */
  'hasGoodWebsite',
  /** `includeNoWebsiteOnly` was set, so a business with any website was passed over unchecked. */
  'hasWebsite',
  /** The day's site-check allowance ran out before this one was reached. */
  'quotaReached',
] as const

export type SkipReason = (typeof SKIP_REASONS)[number]

/**
 * Reasons that are a decision about the BUSINESS, and therefore worth remembering.
 *
 * A row in `skipped_places` is permanent and it is a silencer: that place ID is
 * invisible to every future search until somebody names it in `save_leads`. So
 * the test for writing one is not "did we discard this" — everything discarded
 * fails that test — it is "would we discard it again for the same reason".
 *
 * Four reasons fail that test, and each would be a quiet bug:
 *
 *   quotaReached        The clock ran out before this one was reached. Nobody
 *                       judged it. Recording a decision that was never made
 *                       would lose the business for ever; it comes back
 *                       tomorrow with the new day's allowance.
 *   hasWebsite          `includeNoWebsiteOnly` was set, so it was passed over
 *                       unchecked. That is a fact about the CALL, not the
 *                       business — remembering it would mean one narrow search
 *                       permanently hid every website-owning business in a town.
 *   belowPreselection   It missed `minReviewCount` / `minRating`, which are
 *                       arguments the operator is invited to lower. Remembering
 *                       it would silently disable the parameter that exists to
 *                       change it. Re-deriving it costs nothing, so there is no
 *                       quota argument on the other side.
 *   alreadyKnown        Already recorded. Re-writing would push `checked_at`
 *                       forward and make a judgement from March look like one
 *                       from this morning — the one field a future re-check
 *                       would be selected on.
 *
 * What is left are the five that will read the same way next month: closed,
 * uncontactable, unrated, badly rated, and — the expensive one this table was
 * built for — checked, and the website was fine.
 */
const NOT_REMEMBERED = new Set<SkipReason>([
  'quotaReached',
  'hasWebsite',
  'belowPreselection',
  'alreadyKnown',
])

export function isRemembered(reason: SkipReason): boolean {
  return !NOT_REMEMBERED.has(reason)
}

/**
 * The hard floors. A business below any of these is never saved, whatever the
 * caller asks for — these are not parameters and are not meant to become any.
 *
 * The argument for them being fixed: they describe a business the operator
 * would refuse on the phone within a sentence. Two reviews is not a reputation,
 * a 2.8 average is a business with a problem this product cannot fix, and a
 * closed shop is not a lead. Lowering them would not widen the funnel, it would
 * fill the book with rows he will delete one at a time.
 */
export const HARD_FLOOR = {
  minReviewCount: 5,
  minRating: 3.5,
  /** Google's own word for "open". Anything else — CLOSED_PERMANENTLY, CLOSED_TEMPORARILY — is out. */
  businessStatus: 'OPERATIONAL',
} as const

/**
 * The pre-selection bar for a business that already has a website.
 *
 * Overridable per call, unlike the floors above, because this one is a budget
 * decision rather than a judgement about the business: it says which sites are
 * worth spending a request on today. A quiet afternoon and a full allowance is
 * a reason to lower it; a market already worked twice is a reason to raise it.
 */
export const PRESELECTION_DEFAULTS = {
  minReviewCount: 15,
  minRating: 4.0,
} as const

/** What a saved lead looks like in the tool's answer. One line per business. */
export interface SavedLead {
  placeId: string
  name: string | null
  city: string | null
  leadType: LeadType
  rating: number | null
  reviewCount: number | null
  weaknessSignals: WeaknessSignal[]
}

/**
 * The discarded, as counts and nothing else.
 *
 * Deliberately not a list. Sixty results in and six saved means fifty-four rows
 * the assistant would otherwise read back into a context window that has a
 * conversation to hold — and every one of them is a business the rule already
 * decided about. The total says how much work was done; the breakdown says
 * whether the rule is behaving. Neither needs a name attached.
 */
export interface SkippedSummary {
  total: number
  byReason: Partial<Record<SkipReason, number>>
}

/**
 * What the run consumed.
 *
 * Two different kinds of scarce, reported together because the operator reads
 * them as one question. `placesCalls` is money — it lands in `api_usage` and is
 * bounded by the monthly ceiling. `siteChecks` is not money at all; it is
 * unattended requests to other people's servers, bounded by a daily count. See
 * the migration for why the second needed a ceiling of its own.
 */
export interface QuotaUsed {
  placesCalls: number
  siteChecks: number
  /** Site checks left today, after this run. The allowance is per UTC day. */
  remainingToday: number
}

export interface SearchPlacesResult {
  saved: SavedLead[]
  skipped: SkippedSummary
  quotaUsed: QuotaUsed
  /**
   * Present only when the run was cut short or nothing was written.
   *
   * The three fields above cannot express "the monthly ceiling stopped this
   * after twenty results" or "autoSave was off, so this is what WOULD have been
   * saved" — and both of those read as `saved: []` or as a short list, which is
   * indistinguishable from a well-worked market. One sentence, omitted entirely
   * when the run was ordinary, so the common answer stays the shape above.
   */
  notice?: string
}

export function countByReason(reasons: SkipReason[]): SkippedSummary {
  const byReason: Partial<Record<SkipReason, number>> = {}
  for (const reason of reasons) {
    byReason[reason] = (byReason[reason] ?? 0) + 1
  }
  return { total: reasons.length, byReason }
}
