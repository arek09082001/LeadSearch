/*
 * What changed about a business since the last time Google was asked.
 *
 * The counterpart to `lib/enrichment/vocabulary.ts`, and deliberately built the
 * same way: a closed list of codes, a spec per code carrying a two-word mark and
 * a full label, and no logic anywhere else that restates what a code means. The
 * refresh pass writes codes; the table, the queue and the lead's page render
 * them through this file. There must not be two lists.
 *
 * WHY THIS IS A SEPARATE VOCABULARY FROM THE FINDINGS. A finding is a judgement
 * about a website — a thing to sell against, weighted by the scorer. A change is
 * news about a business, and news has a direction rather than a severity. "They
 * finally built a website" is the single most important thing this product can
 * tell the operator and it is not a fault; scoring it as one would be a category
 * error, and colouring it like one would read as an alarm.
 *
 * The direction is what the UI spends its ink on:
 *
 *   lost     — the lead got worse for us and better for them. The opening is
 *              closing: they built a site, they got reviews, they got good.
 *   gained   — the lead got better for us. Their site went away, their rating
 *              slipped. Rarer, and worth a call.
 *   neutral  — a fact that changed and carries no argument either way.
 *
 * Nothing here is `server-only`: the refresh pass computes these and every list
 * surface renders them.
 */

export const CHANGE_CODES = [
  'website_appeared',
  'website_gone',
  'website_changed',
  'reviews_up',
  'reviews_down',
  'rating_up',
  'rating_down',
  'phone_changed',
  'name_changed',
  'closed',
  'reopened',
  'delisted',
] as const

export type ChangeCode = (typeof CHANGE_CODES)[number]

export type ChangeDirection = 'lost' | 'gained' | 'neutral'

export interface ChangeSpec {
  direction: ChangeDirection
  /** Two or three words. What a table row has space for. */
  mark: string
  /** The full sentence-fragment name, for the lead's own page. */
  label: string
  /**
   * Whether this change makes the diagnosis on file wrong rather than merely
   * older. Anything true here re-audits immediately instead of waiting for the
   * slow cadence — the audit under this lead is now about a site that is not
   * there, or about no site when there is one.
   */
  invalidatesAudit: boolean
}

export const CHANGE_SPECS: Record<ChangeCode, ChangeSpec> = {
  website_appeared: {
    direction: 'lost',
    mark: 'Built a site',
    label: 'They have built a website since this lead was saved',
    invalidatesAudit: true,
  },
  website_gone: {
    direction: 'gained',
    mark: 'Site gone',
    label: 'Google no longer lists a website for them',
    invalidatesAudit: true,
  },
  website_changed: {
    direction: 'neutral',
    mark: 'New address',
    label: 'Their website is at a different address than it was',
    invalidatesAudit: true,
  },
  reviews_up: {
    direction: 'lost',
    mark: 'More reviews',
    label: 'They have gained reviews since this lead was saved',
    invalidatesAudit: false,
  },
  reviews_down: {
    direction: 'gained',
    mark: 'Fewer reviews',
    label: 'They have lost reviews since this lead was saved',
    invalidatesAudit: false,
  },
  rating_up: {
    direction: 'lost',
    mark: 'Rating up',
    label: 'Their rating has risen',
    invalidatesAudit: false,
  },
  rating_down: {
    direction: 'gained',
    mark: 'Rating down',
    label: 'Their rating has fallen',
    invalidatesAudit: false,
  },
  phone_changed: {
    direction: 'neutral',
    mark: 'New number',
    label: 'Their phone number has changed — the one on file will not reach them',
    invalidatesAudit: false,
  },
  name_changed: {
    direction: 'neutral',
    mark: 'Renamed',
    label: 'The business trades under a different name now',
    invalidatesAudit: false,
  },
  closed: {
    direction: 'lost',
    mark: 'Closed',
    label: 'Google has marked this business permanently closed',
    invalidatesAudit: false,
  },
  reopened: {
    direction: 'gained',
    mark: 'Reopened',
    label: 'Google no longer marks this business closed',
    invalidatesAudit: false,
  },
  delisted: {
    direction: 'neutral',
    mark: 'Delisted',
    label: 'Google no longer has a listing under this place ID',
    invalidatesAudit: false,
  },
}

/**
 * How small a movement is not news.
 *
 * A rating is `numeric(2,1)`, so anything at all is a tenth of a star and worth
 * saying. Review counts drift by one as Google re-indexes; a single review is
 * not a change of circumstances, and a row that says "more reviews" every month
 * is a row the operator stops reading.
 */
export const CHANGE_THRESHOLDS = {
  minReviewDelta: 3,
  minRatingDelta: 0.1,
} as const

const DIRECTION_RANK: Record<ChangeDirection, number> = { lost: 0, gained: 1, neutral: 2 }

export function isChangeCode(value: string): value is ChangeCode {
  return value in CHANGE_SPECS
}

/**
 * Order a set of codes so the ones that change the pitch come first.
 *
 * `lost` leads because that is the closing window — the lead he has to call
 * this week or not at all. Alphabetical inside a direction, so two renders of
 * the same set never disagree.
 */
export function sortChanges(codes: readonly string[]): ChangeCode[] {
  return codes.filter(isChangeCode).sort((a, b) => {
    const byDirection =
      DIRECTION_RANK[CHANGE_SPECS[a].direction] - DIRECTION_RANK[CHANGE_SPECS[b].direction]
    return byDirection !== 0 ? byDirection : a.localeCompare(b)
  })
}

/** True when any of these changes makes the audit on file describe a different site. */
export function invalidatesAudit(codes: readonly string[]): boolean {
  return codes.some((code) => isChangeCode(code) && CHANGE_SPECS[code].invalidatesAudit)
}

/**
 * The filters the library offers over changes.
 *
 * Derived from the vocabulary rather than restated, exactly as the audit
 * filters are, so a new code is filterable the moment it exists.
 */
export const CHANGE_FILTERS = CHANGE_CODES.map((code) => ({
  key: code,
  label: CHANGE_SPECS[code].mark,
  direction: CHANGE_SPECS[code].direction,
}))
