import type {
  BriefingContact,
  BriefingFinding,
  BriefingInput,
  BriefingPass,
  BriefingReview,
  BriefingScore,
  FindingEvidence,
} from '@/lib/assistant/types'
import { FINDING_SPECS, isFindingCode, severityRank } from '@/lib/enrichment/vocabulary'
import { formatPlaceType } from '@/lib/places-types'
import { SCORING_CONFIG } from '@/lib/scoring/config'
import type { StoredScore } from '@/lib/scoring/score'
import type { AuditFinding, LeadAudit, LeadRow, TimelineEntry } from '@/lib/leads/types'

/*
 * Everything the assistant is told, assembled deterministically.
 *
 * PURE, in the sense `score.ts` and `outcomes.ts` are pure: no database, no
 * network, and — the one worth stating — no clock. Every date in the result was
 * read off a row. That matters more here than anywhere else in the product,
 * because this is the input to something that will one day be a language model,
 * and the only way to argue with a model's answer is to be able to reproduce
 * exactly what it was asked. A builder that quietly folded in `new Date()`
 * would make yesterday's briefing unreproducible today.
 *
 * The consequence to keep in mind when extending it: this function may not
 * decide anything. It selects, orders and flattens. Every sentence in it comes
 * from `findings.ts` by way of the audit, every number from `config.ts` by way
 * of the score. If a fault needs better words, the words are wrong in
 * `findings.ts` and this file must not paper over them — the audit page reads
 * the same sentences, and two versions of one claim is how a product starts
 * lying to itself.
 */

/** History lines carried. Enough to know this is not a first call; not a diary. */
const MAX_HISTORY = 10

/**
 * How much of one note is carried.
 *
 * A note may run to two thousand characters, and ten of them would be most of
 * the input. The newest lines are what change the opener — the middle of a long
 * note from March does not — so they are cut rather than dropped, and the cut is
 * visible.
 */
const MAX_NOTE = 400

/** Evidence pairs per finding. More than this is a measurement list, not proof. */
const MAX_EVIDENCE = 4

/** The outreach kinds that mean somebody was actually approached. */
const CONTACT_TYPES = new Set(['call', 'email', 'message', 'visit', 'meeting'])

/* ------------------------------------------------------------------------- *
 * Source
 * ------------------------------------------------------------------------- */

/**
 * The rows this is built from — `LeadDetail` minus the parts a briefing has no
 * use for, plus the reviews, which no other surface reads.
 *
 * Reviews arrive as an object rather than an array so that "fetched, and there
 * were none" is expressible. Those two states cost differently and read
 * differently: a business with no reviews at all is worth mentioning on a call,
 * and a business nobody asked about is worth asking about.
 */
export interface BriefingSource {
  lead: LeadRow
  audit: LeadAudit | null
  score: StoredScore | null
  timeline: TimelineEntry[]
  reviews: { fetchedAt: string; items: BriefingReview[] } | null
}

/* ------------------------------------------------------------------------- *
 * Evidence
 * ------------------------------------------------------------------------- */

/**
 * `expiredMonthsAgo` becomes `expired months ago`. Enough to say out loud.
 *
 * The inserted words are lowercased as well as separated. Splitting alone
 * leaves `lcpMs` reading as "lcp Ms" — which is not merely ugly: these labels
 * are how `fixtures/phrasing.ts` finds a measurement again, so a stray capital
 * is a lookup that silently returns nothing and an evidence line that silently
 * does not appear.
 */
function humanKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, (_, before: string, after: string) => `${before} ${after.toLowerCase()}`)
    .replace(/^./, (first) => first.toLowerCase())
}

function humanValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.length ? value.join(', ') : null
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  return String(value).slice(0, 160)
}

/**
 * The proof under one claim, flattened.
 *
 * `reportUrl` is dropped: it is a link to go and check, which is exactly what
 * nobody does while a phone is ringing. Everything else the check recorded is
 * carried through generically, so a criterion that starts recording a new
 * measurement carries it into the briefing without anybody editing this file —
 * the same bargain the diagnosis page makes.
 */
function evidenceOf(value: Record<string, unknown> | null): FindingEvidence[] {
  if (!value) return []

  const pairs: FindingEvidence[] = []
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'reportUrl') continue
    const text = humanValue(entry)
    if (text === null) continue
    pairs.push({ label: humanKey(key), value: text })
    if (pairs.length === MAX_EVIDENCE) break
  }
  return pairs
}

/* ------------------------------------------------------------------------- *
 * Findings
 * ------------------------------------------------------------------------- */

/**
 * What one fault is worth on THIS lead.
 *
 * The score's own contribution first, because it already accounts for position:
 * the scorer applies a diminishing rule, so the fourth fault on a lead is worth
 * less than the same fault would be on a lead that has only that one. Falling
 * back to the configured weight keeps an unscored lead orderable, and zero is
 * the floor for a code the vocabulary no longer knows.
 */
function strengthOf(finding: BriefingFinding): number {
  return finding.contribution ?? finding.weight ?? 0
}

function byStrength(a: BriefingFinding, b: BriefingFinding): number {
  const strength = strengthOf(b) - strengthOf(a)
  if (strength !== 0) return strength
  const severity = severityRank(a.severity) - severityRank(b.severity)
  return severity !== 0 ? severity : a.code.localeCompare(b.code)
}

function toFinding(
  finding: AuditFinding,
  contributions: Map<string, number>,
): BriefingFinding {
  // Aliased so the type guard narrows for both lookups below. `finding.code` is
  // a property of a parameter and the checker will not carry a guard on it into
  // a later expression.
  const code = finding.code
  const spec = isFindingCode(code) ? FINDING_SPECS[code] : null

  return {
    code,
    // A code this vocabulary has since dropped keeps its own name rather than
    // disappearing. It was measured, it was written down, and a briefing that
    // silently omitted it would be shorter than the diagnosis beside it.
    mark: spec?.mark ?? finding.code,
    label: spec?.label ?? finding.code,
    category: finding.category,
    severity: finding.severity,
    message: finding.message,
    evidence: evidenceOf(finding.value),
    weight: isFindingCode(code) ? SCORING_CONFIG.points[code] : null,
    contribution: contributions.get(code) ?? null,
  }
}

/* ------------------------------------------------------------------------- *
 * History
 * ------------------------------------------------------------------------- */

function toContact(entry: TimelineEntry): BriefingContact {
  return {
    at: entry.at,
    kind: entry.kind,
    type: entry.type,
    body: entry.body === null ? null : entry.body.slice(0, MAX_NOTE),
    statusBefore: entry.statusBefore,
    statusAfter: entry.statusAfter,
  }
}

/**
 * What has already passed between the operator and this business.
 *
 * Refresh entries are deliberately excluded. They record what Google changed its
 * mind about, which is a fact about the data rather than about the relationship,
 * and the faults already carry whatever it did to the diagnosis. What belongs
 * here is only what somebody did: a call, a note, a status moved by hand.
 */
function historyOf(lead: LeadRow, timeline: TimelineEntry[]): BriefingInput['history'] {
  const own = timeline.filter((entry) => entry.kind !== 'refresh')

  const contacts = own.filter(
    (entry) => entry.kind === 'activity' && entry.type !== null && CONTACT_TYPES.has(entry.type),
  )

  return {
    status: lead.status,
    attempts: contacts.length,
    // The timeline arrives newest first, so the first contact in it is the last
    // one that happened. Read rather than computed, like every other date here.
    lastContactAt: contacts[0]?.at ?? null,
    followUpAt: lead.followUpAt,
    savedAt: lead.savedAt,
    entries: own.slice(0, MAX_HISTORY).map(toContact),
  }
}

/* ------------------------------------------------------------------------- *
 * Score
 * ------------------------------------------------------------------------- */

function scoreOf(stored: StoredScore | null): BriefingScore | null {
  if (!stored?.breakdown) return null
  const { breakdown } = stored

  return {
    score: breakdown.score,
    excluded: breakdown.excluded,
    factors: breakdown.factors.map((factor) => ({
      code: factor.code,
      label: factor.label,
      severity: factor.severity,
      weight: factor.weight,
      contribution: factor.contribution,
    })),
    configVersion: stored.configVersion,
    computedAt: stored.computedAt,
  }
}

/* ------------------------------------------------------------------------- *
 * The builder
 * ------------------------------------------------------------------------- */

export function buildBriefingInput(source: BriefingSource): BriefingInput {
  const { lead, audit, score, timeline, reviews } = source

  const contributions = new Map(
    (score?.breakdown?.factors ?? []).map((factor) => [factor.code, factor.contribution]),
  )

  const failed = (audit?.findings ?? [])
    .filter((finding) => !finding.passed)
    .map((finding) => toFinding(finding, contributions))

  /*
   * Compliance is split out by category rather than by a hand-kept list of
   * codes. `vocabulary.ts` already draws exactly this line — `compliance` is the
   * Impressum, the privacy policy, the things loaded from Google's servers
   * without asking — and re-deriving it here from a list would be a second
   * definition of the same idea, guaranteed to drift the first time a check is
   * added.
   */
  const compliance = failed.filter((finding) => finding.category === 'compliance').sort(byStrength)
  const faults = failed.filter((finding) => finding.category !== 'compliance').sort(byStrength)

  const passed: BriefingPass[] = (audit?.findings ?? [])
    .filter((finding) => finding.passed)
    .map((finding) => ({
      code: finding.code,
      mark: isFindingCode(finding.code) ? FINDING_SPECS[finding.code].mark : finding.code,
      message: finding.message,
    }))

  return {
    business: {
      name: lead.name,
      category: lead.primaryType ? formatPlaceType(lead.primaryType) : null,
      city: lead.city,
      formattedAddress: lead.formattedAddress,
      phone: lead.phone ?? lead.imprintPhone,
      website: lead.website,
      rating: lead.rating,
      reviewCount: lead.userRatingCount,
    },
    faults,
    compliance,
    passed,
    score: scoreOf(score),
    screenshot: Boolean(audit?.screenshotPath),
    history: historyOf(lead, timeline),
    reviews: reviews?.items ?? [],
    reviewsFetched: reviews !== null,
    asOf: {
      google: lead.fetchedAt,
      diagnosis: audit?.auditedAt ?? null,
      reviews: reviews?.fetchedAt ?? null,
    },
  }
}
