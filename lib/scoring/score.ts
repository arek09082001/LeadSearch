import { SCORING_CONFIG, type ScoringConfig, type SignalTier } from '@/lib/scoring/config'
import {
  FINDING_SPECS,
  isFindingCode,
  severityRank,
  type FindingSeverity,
} from '@/lib/enrichment/vocabulary'

/*
 * How good a lead is, and why.
 *
 * Pure — no network, no database, no clock — for exactly the reason `findings.ts`
 * is pure. Everything this needs is already written down: the findings are in
 * the audit, the rating and review count are on the lead. So re-ranking the
 * whole book after an argument with `config.ts` is a loop over stored rows that
 * costs nothing and takes seconds, rather than five hundred websites re-fetched
 * to answer a question none of them were ever asked.
 *
 * The other half of that purity is the breakdown. This never returns a bare
 * number: it returns every step that produced it, because a lead sitting at 84
 * has to be able to say which four faults and which multiplier got it there, two
 * months later, with nobody remembering the run. The score is stored WITH its
 * breakdown and its config version for the same reason.
 *
 * THE SHAPE, in one place, since it is spread across three tunables:
 *
 *   1. Failed findings only, sorted worst-first.
 *   2. Each one after the first is worth `diminishing` times the last — so a
 *      long tail of small faults cannot out-rank a single decisive one.
 *   3. The total maps onto 0–100 against `fullScale`, and saturates there.
 *   4. The business signal multiplies that, and the result is clamped to 0–100.
 *
 * Step 4 is last on purpose. The multiplier says how much the business is worth
 * calling, and applying it to the saturated strength keeps it meaning that at
 * every point of the range — folding it into the points before the curve would
 * quietly compress it exactly where the good leads are.
 */

/**
 * A finding, reduced to what scoring actually reads.
 *
 * Structural rather than an import of `Finding`, so both sides fit without a
 * conversion: the pass holds `Finding` objects it just computed, the rescore
 * holds `AuditFinding` rows it just read out of Postgres, and neither has to
 * be reshaped to be scored. `code` is `string` because the database's is.
 */
export interface ScorableFinding {
  code: string
  passed: boolean
}

/** What Google says about the business itself, as opposed to its website. */
export interface BusinessSignals {
  rating: number | null
  reviews: number | null
  /** `leads.business_status`, straight from Places. */
  businessStatus: string | null
}

/** One fault, and what it was worth after the diminishing rule. */
export interface ScoreFactor {
  code: string
  /** From the shared vocabulary, so the breakdown and the diagnosis agree. */
  label: string
  severity: FindingSeverity
  /** The configured points for this code, before position. */
  weight: number
  /** What position in the list left of it, 0–1. The first fault keeps all of it. */
  retained: number
  /** weight × retained. What this fault actually added. */
  contribution: number
}

export interface ScoreSignal {
  key: string
  label: string
  multiplier: number
  rating: number | null
  reviews: number | null
}

export interface ScoreBreakdown {
  configVersion: string
  /**
   * 0–100, or null when the business is excluded from ranking.
   *
   * Null is not zero and the two must never be conflated: zero means "audited,
   * nothing wrong with it", null means "not a lead". Both sink to the bottom of
   * the list, and only one of them is worth reading.
   */
  score: number | null
  /** Set when `score` is null. Says which rule took the lead out, in words. */
  excluded: { rule: string; reason: string } | null
  factors: ScoreFactor[]
  /** Sum of the contributions above. */
  points: number
  /** Those points on 0–100, before the business signal. */
  strength: number
  signal: ScoreSignal
  /**
   * The two knobs that shaped the arithmetic, copied in.
   *
   * `configVersion` names the config; this reproduces the part of it that
   * actually moved this number. Without it a stored breakdown can show its
   * points and its score but not why one became the other, which is exactly the
   * question asked of a score whose config has since been edited.
   */
  scale: { fullScale: number; diminishing: number }
}

/**
 * A score as it comes back out of the database.
 *
 * Here rather than in `store.ts` because the diagnosis renders it and the
 * diagnosis must not import a `server-only` module. The breakdown may be null:
 * a score written under an older shape still stands as a number, it just cannot
 * explain itself, and saying so is better than rendering a guess.
 */
export interface StoredScore {
  id: string
  score: number | null
  configVersion: string
  computedAt: string
  breakdown: ScoreBreakdown | null
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Two decimals. Enough to audit the arithmetic, not enough to be noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Which tier this business falls in.
 *
 * First match wins, and the last tier in the config states no bounds, so this
 * always returns something. The fallback below is unreachable with a sane
 * config and exists so that a config edited down to nothing still scores.
 */
function matchTier(tiers: readonly SignalTier[], rating: number | null, reviews: number): SignalTier {
  for (const tier of tiers) {
    if (tier.minRating !== undefined && (rating === null || rating < tier.minRating)) continue
    if (tier.minReviews !== undefined && reviews < tier.minReviews) continue
    if (tier.maxReviews !== undefined && reviews > tier.maxReviews) continue
    return tier
  }
  return { key: 'unmatched', label: 'No tier matched', multiplier: 1 }
}

/**
 * Worst first, and deterministically.
 *
 * The diminishing rule makes order load-bearing — it decides which fault keeps
 * its full weight — so ties cannot be left to whatever order the findings came
 * back in. Points first, then severity, then the code itself: two runs over the
 * same audit must produce the same breakdown, or the history stops meaning
 * anything.
 */
function worstFirst(a: ScoreFactor, b: ScoreFactor): number {
  if (b.weight !== a.weight) return b.weight - a.weight
  const bySeverity = severityRank(a.severity) - severityRank(b.severity)
  return bySeverity !== 0 ? bySeverity : a.code.localeCompare(b.code)
}

/**
 * Score one lead off its findings and what Google says about the business.
 *
 * `findings` is the whole set, passes included — this filters. Handing it the
 * failures only would work, but every caller would then have to remember to
 * filter and the one that forgot would silently score everything at zero.
 */
export function scoreLead(
  findings: readonly ScorableFinding[],
  signals: BusinessSignals,
  config: ScoringConfig = SCORING_CONFIG,
): ScoreBreakdown {
  const rating = signals.rating ?? null
  /*
   * A missing review count is read as none.
   *
   * Places omits the field rather than sending 0, so null is what "nobody has
   * reviewed them" actually looks like on the wire. It is still not treated as
   * grounds for EXCLUSION — that stays reserved for an explicit zero, because
   * excluding a lead is irreversible-looking to the operator and a field Google
   * simply did not return is a thin reason to do it. It lands in the weakest
   * tier instead, which is the same conclusion held less strongly.
   */
  const reviews = signals.reviews ?? 0

  const factors: ScoreFactor[] = []
  for (const entry of findings) {
    if (entry.passed) continue
    const spec = isFindingCode(entry.code) ? FINDING_SPECS[entry.code] : null
    factors.push({
      code: entry.code,
      label: spec?.label ?? entry.code,
      severity: spec?.severity ?? 'info',
      /*
       * A code with no configured points scores nothing and is listed anyway.
       * `points` is typed to cover the whole vocabulary, so this is only
       * reachable by a finding row written under a newer vocabulary than this
       * build knows — and a fault visibly worth 0 is a better way to find that
       * out than a fault that quietly is not there.
       */
      weight: isFindingCode(entry.code) ? config.points[entry.code] : 0,
      retained: 1,
      contribution: 0,
    })
  }

  factors.sort(worstFirst)

  let points = 0
  factors.forEach((factor, index) => {
    factor.retained = round2(Math.pow(config.diminishing, index))
    factor.contribution = round2(factor.weight * Math.pow(config.diminishing, index))
    points += factor.contribution
  })
  points = round2(points)

  const tier = matchTier(config.signals.tiers, rating, reviews)
  const signal: ScoreSignal = {
    key: tier.key,
    label: tier.label,
    multiplier: tier.multiplier,
    rating,
    reviews: signals.reviews ?? null,
  }

  const strength = round2(clamp((points / config.fullScale) * 100, 0, 100))

  /*
   * Exclusion is decided last, and everything above it is computed anyway.
   *
   * The score is withheld, not the explanation. An operator looking at a
   * permanently closed business still gets to see that its site was a wreck and
   * that this is why it is not in his list — which is the difference between a
   * ranking he trusts and one that drops rows for reasons he cannot see.
   */
  const excluded = exclusionFor(signals, config)

  return {
    configVersion: config.version,
    score: excluded ? null : clamp(Math.round(strength * tier.multiplier), 0, 100),
    excluded,
    factors,
    points,
    strength,
    signal,
    scale: { fullScale: config.fullScale, diminishing: config.diminishing },
  }
}

function exclusionFor(
  signals: BusinessSignals,
  config: ScoringConfig,
): { rule: string; reason: string } | null {
  const status = signals.businessStatus
  if (status && config.signals.closedStatuses.includes(status)) {
    return {
      rule: 'closed',
      reason: 'Google has this business marked permanently closed. There is nobody to sell to.',
    }
  }

  if (config.signals.excludeWhenNoReviews && signals.reviews === 0) {
    return {
      rule: 'no_reviews',
      reason:
        'Not one review on Google. Either they are not really trading or Google does not know they exist, and a broken website is not a reason to phone either of those.',
    }
  }

  return null
}
