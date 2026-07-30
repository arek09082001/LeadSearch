import type { FindingCode } from '@/lib/enrichment/vocabulary'

/*
 * What a lead is worth, as numbers.
 *
 * This file is the whole tuning surface. It holds no logic — `score.ts` reads
 * it and does the arithmetic — so an afternoon spent arguing with the ranking
 * is an afternoon spent editing constants, and every one of those edits is
 * re-runnable over the whole book for free by the bulk rescore.
 *
 * BUMP `version` WHEN YOU CHANGE ANYTHING HERE. It is written onto every score
 * row, and it is the only thing that makes a two-year-old 84 explainable: it
 * says which version of this file's opinions produced it. Scores already
 * written keep the version they were computed under and are never rewritten.
 */

export interface SignalTier {
  /** Stable identifier. Written into the breakdown, so keep it when renaming. */
  key: string
  /** What the diagnosis says out loud. */
  label: string
  /** All stated bounds must hold for the tier to match. Omitted means unbounded. */
  minRating?: number
  minReviews?: number
  maxReviews?: number
  multiplier: number
}

export interface ScoringConfig {
  version: string

  /**
   * Points per failed finding. A passed finding is worth nothing — this scores
   * what is wrong with a business's web presence, not what is right with it.
   *
   * Every code in the vocabulary must appear. That is deliberate: adding a
   * check to `vocabulary.ts` without deciding what it is worth would silently
   * add a fault that never moves a lead, and the type error is the reminder.
   */
  points: Readonly<Record<FindingCode, number>>

  /**
   * What each additional fault is worth, relative to the one above it.
   *
   * Faults are sorted worst-first and each subsequent one is multiplied by this
   * again — 1, 0.5, 0.25, 0.125. Without it the arithmetic ranks a 2010 site
   * that fails ten small checks (112 raw points) far above a business with no
   * website at all (45), which inverts the operator's actual priority: absence
   * and death are the best leads, and a long tail of hygiene complaints is not
   * a better call than "they have no website".
   *
   * It is also what keeps the hygiene weights honest. Missing title, meta and
   * favicon together contribute 6 + 2 + 0.5 rather than 12, which is what
   * "keep them small" has to mean once several of them land at once.
   *
   * 1.0 turns this off and makes the sum plainly additive.
   */
  diminishing: number

  /**
   * The point total that reads as a perfect lead, before the business signal.
   *
   * Points map onto 0–100 linearly against this and saturate there. It is the
   * one number that moves the whole distribution: lower it and the book scores
   * higher across the board.
   *
   * 65 is set by the operator's own target. `no_website` is 45 points on its
   * own, so 45/65 = 69 strength, and a thriving business's 1.35 takes that to
   * 93 — the "no_website on a 4.6-star, 120-review business lands 90+" case.
   */
  fullScale: number

  signals: {
    /**
     * `business_status` values that take a lead out of the ranking entirely.
     * Google Places v1 says CLOSED_PERMANENTLY; CLOSED_TEMPORARILY is not here
     * on purpose, because a business closed for a refit still buys websites.
     */
    closedStatuses: readonly string[]
    /**
     * Nobody has ever reviewed them. Either they are not really trading or
     * Google does not know they exist — neither is worth a phone call, and
     * both would otherwise ride a bad website to the top of the list.
     */
    excludeWhenNoReviews: boolean
    /**
     * First match wins, so these are ordered strongest to weakest. The last
     * entry states no bounds and therefore always matches, which is what makes
     * the multiplier total rather than optional.
     */
    tiers: readonly SignalTier[]
  }
}

export const SCORING_CONFIG: ScoringConfig = {
  version: '2026-07-30.1',

  points: {
    /* ---- absence and death: the best leads ------------------------------ */
    no_website: 45,
    dead_domain: 42,
    site_unreachable: 38,
    http_error: 30,

    /* ---- broken trust --------------------------------------------------- */
    no_https: 25,
    invalid_certificate: 25,

    /* ---- not a real site ------------------------------------------------ */
    social_only: 35,
    free_subdomain: 22,
    diy_platform: 14,

    /* ---- obsolete ------------------------------------------------------- */
    dated_markup: 18,
    outdated_wordpress: 16,
    stale_copyright: 12,

    /* ---- performance and mobile ----------------------------------------- */
    not_mobile_friendly: 22,
    psi_poor: 20,
    psi_weak: 10,
    poor_lcp: 12,
    layout_shift: 8,
    slow_response: 8,

    /* ---- hygiene: weak signals, kept small ------------------------------ */
    no_title: 6,
    no_meta_description: 4,
    no_favicon: 2,
  },

  diminishing: 0.5,
  fullScale: 65,

  signals: {
    closedStatuses: ['CLOSED_PERMANENTLY'],
    excludeWhenNoReviews: true,

    /*
     * What separates a dead one-star shop from a thriving business that never
     * got round to a website. The faults are identical; the call is not.
     */
    tiers: [
      {
        key: 'thriving',
        label: 'Thriving — 4.5★ and 50+ reviews',
        minRating: 4.5,
        minReviews: 50,
        multiplier: 1.35,
      },
      {
        key: 'healthy',
        label: 'Healthy — 4.0★ and 30+ reviews',
        minRating: 4.0,
        minReviews: 30,
        multiplier: 1.2,
      },
      {
        key: 'established',
        label: 'Established — 3.5★ and 10+ reviews',
        minRating: 3.5,
        minReviews: 10,
        multiplier: 1.0,
      },
      {
        key: 'unproven',
        /*
         * Reaches leads with no review count at all, because `reviews` is
         * normalised to 0 before the tiers are read. That is the cautious
         * reading: a business Google has nothing to say about is not one to
         * put at the top of the call list on the strength of a broken site.
         */
        label: 'Barely reviewed — under 10 reviews',
        maxReviews: 9,
        multiplier: 0.55,
      },
      {
        /*
         * Everything the tiers above did not catch — in practice a business
         * with plenty of reviews and a rating under 3.5. Well known and badly
         * liked is still a real business with real customers, so it is scored
         * on its website alone rather than promoted or punished for its stars.
         */
        key: 'ordinary',
        label: 'An ordinary business',
        multiplier: 1.0,
      },
    ],
  },
}
