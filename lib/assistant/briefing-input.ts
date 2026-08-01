import type {
  AssistantLead,
  BriefingFinding,
  BriefingInput,
  BriefingMeasurements,
  BriefingReview,
} from '@/lib/assistant/types'
import { FINDING_SPECS, isFindingCode, severityRank } from '@/lib/enrichment/vocabulary'
import { SCORING_CONFIG } from '@/lib/scoring/config'
import type { StoredScore } from '@/lib/scoring/score'
import type { LeadAudit, LeadRow, TimelineEntry } from '@/lib/leads/types'

/*
 * Everything the assistant is told, assembled deterministically.
 *
 * `types.ts` states that the providers do no I/O of their own and that every
 * input arrives fully assembled. This is the half that assembles it — the only
 * module that knows both what a `LeadDetail` looks like and what a provider is
 * owed, and it is deliberately the boring one.
 *
 * PURE, in the sense `score.ts` and `outcomes.ts` are pure: no database, no
 * network, and — the one worth stating — no clock. Every date in the result was
 * read off a row. That matters more here than anywhere else in the product,
 * because this is the input to something that will be a language model, and the
 * only way to argue with a model's answer is to reproduce exactly what it was
 * asked. A builder that quietly folded in `new Date()` would make yesterday's
 * briefing unreproducible today.
 *
 * The consequence to keep in mind when extending it: this function may not
 * decide anything. It selects, orders and narrows. Which fault opens the call is
 * the provider's judgement — `fixtures/index.ts` holds today's version of it —
 * and a builder that pre-sorted by its own opinion would be making that decision
 * twice, in two places, with no way to tell which one was in force.
 */

/**
 * Notes carried into the briefing, newest first.
 *
 * `types.ts` says the caller truncates because only the caller knows how much of
 * a year of notes is worth reading. This is that decision: the last handful, cut
 * to a length that can be read rather than skimmed. Once a model is behind the
 * boundary every one of these is a line being paid for on every call.
 */
const MAX_NOTES = 5
const MAX_NOTE_LENGTH = 400

/** The outreach kinds that mean somebody was actually approached. */
const CONTACT_TYPES = new Set(['call', 'email', 'message', 'visit', 'meeting'])

/* ------------------------------------------------------------------------- *
 * Source
 * ------------------------------------------------------------------------- */

/**
 * The rows this is built from — `LeadDetail` minus what a briefing has no use
 * for, plus the two things no other surface reads.
 *
 * Reviews arrive as an object rather than a bare array so that "fetched, and
 * there were none" is expressible; see `BriefingInput.reviews`.
 */
export interface BriefingSource {
  lead: LeadRow
  audit: LeadAudit | null
  /** Read for the failed codes' weights only — the score itself is on the lead. */
  score: StoredScore | null
  timeline: TimelineEntry[]
  /** Finished call attempts before this one, newest first. */
  previousCalls: { endedAt: string | null; outcome: string | null }[]
  reviews: { items: BriefingReview[] } | null
}

/* ------------------------------------------------------------------------- *
 * Findings
 * ------------------------------------------------------------------------- */

/**
 * What one fault is worth on THIS lead, for ordering only.
 *
 * The score's own contribution first, because it already accounts for position:
 * the scorer applies a diminishing rule, so the fourth fault on a lead is worth
 * less than the same fault would be on a lead carrying only that one. Falling
 * back to the configured weight keeps an unscored lead orderable, and severity
 * breaks the tie for a code the vocabulary no longer knows.
 */
function ordering(contributions: Map<string, number>) {
  return (a: BriefingFinding, b: BriefingFinding): number => {
    const strength = strengthOf(b, contributions) - strengthOf(a, contributions)
    if (strength !== 0) return strength
    const severity = severityRank(a.severity) - severityRank(b.severity)
    return severity !== 0 ? severity : a.code.localeCompare(b.code)
  }
}

function strengthOf(finding: BriefingFinding, contributions: Map<string, number>): number {
  const contribution = contributions.get(finding.code)
  if (contribution !== undefined) return contribution
  return isFindingCode(finding.code) ? SCORING_CONFIG.points[finding.code] : 0
}

/**
 * The failed findings, worst first, with their evidence verbatim.
 *
 * `value` is passed through untouched rather than flattened into strings.
 * `types.ts` is explicit that this is where "PageSpeed 23" stays a measurement
 * instead of becoming the judgement "very slow", and the mock's `fill` reads
 * these keys directly — a builder that pre-formatted them would be a builder
 * deciding how a number gets said.
 *
 * Passing findings are dropped here rather than carried and filtered later,
 * because the shape a provider receives cannot express one: see the note on
 * `BriefingFinding`.
 */
function findingsOf(audit: LeadAudit | null, contributions: Map<string, number>): BriefingFinding[] {
  const failed = (audit?.findings ?? [])
    .filter((finding) => !finding.passed)
    .map((finding): BriefingFinding => {
      // Aliased so the type guard narrows for the lookup below; `finding.code`
      // is a property of a parameter and the checker will not carry a guard on
      // it into a later expression.
      const code = finding.code
      const spec = isFindingCode(code) ? FINDING_SPECS[code] : null

      return {
        code,
        // A code this vocabulary has since dropped keeps its own name rather
        // than disappearing. It was measured and it was written down, and a
        // briefing shorter than the diagnosis beside it is a briefing that
        // quietly stopped agreeing with the page it sits on.
        mark: spec?.mark ?? code,
        label: spec?.label ?? code,
        severity: finding.severity,
        value: finding.value,
      }
    })

  return failed.sort(ordering(contributions))
}

/* ------------------------------------------------------------------------- *
 * Measurements
 * ------------------------------------------------------------------------- */

function measurementsOf(audit: LeadAudit | null): BriefingMeasurements {
  return {
    auditedAt: audit?.auditedAt ?? null,
    websiteStatus: audit?.websiteStatus ?? null,
    psiPerformance: audit?.psiPerformance ?? null,
    loadMs: audit?.loadMs ?? null,
    copyrightYear: audit?.copyrightYear ?? null,
    platform: audit?.platform ?? null,
    platformVersion: audit?.platformVersion ?? null,
  }
}

/* ------------------------------------------------------------------------- *
 * History
 * ------------------------------------------------------------------------- */

/**
 * What has already passed between the operator and this business.
 *
 * TWO SOURCES, because they answer two different questions. `calls` says how
 * many times the phone has been picked up and how the last one was filed; the
 * timeline says what he wrote down. A briefing built from only the first would
 * open a fourth call as though it were the first if the earlier three predate
 * the calls table.
 *
 * Refresh entries are excluded from the notes. They record what Google changed
 * its mind about, which is a fact about the data rather than about the
 * relationship, and the findings already carry whatever it did to the diagnosis.
 */
function historyOf(
  lead: LeadRow,
  timeline: TimelineEntry[],
  previousCalls: BriefingSource['previousCalls'],
): BriefingInput['history'] {
  const own = timeline.filter((entry) => entry.kind !== 'refresh')

  const contacts = own.filter(
    (entry) => entry.kind === 'activity' && entry.type !== null && CONTACT_TYPES.has(entry.type),
  )

  /*
   * The most recent contact of any kind, from whichever source saw it last.
   * Both arrive newest first, so this is a comparison of two heads rather than a
   * scan — and it is a comparison of stored timestamps, never of one against a
   * clock.
   */
  const lastLogged = contacts[0]?.at ?? null
  const lastCalled = previousCalls.find((call) => call.endedAt !== null)?.endedAt ?? null
  const lastContactedAt =
    lastLogged && lastCalled ? (lastLogged > lastCalled ? lastLogged : lastCalled) : (lastLogged ?? lastCalled)

  return {
    lastContactedAt,
    previousCalls: previousCalls.length,
    lastOutcome: previousCalls.find((call) => call.outcome !== null)?.outcome ?? null,
    notes: own
      .filter((entry) => entry.kind === 'note' && entry.body)
      .slice(0, MAX_NOTES)
      .map((entry) => entry.body!.slice(0, MAX_NOTE_LENGTH)),
  }
}

/* ------------------------------------------------------------------------- *
 * The lead
 * ------------------------------------------------------------------------- */

/**
 * `LeadRow` narrowed to what a person needs to open a phone call.
 *
 * Deliberately a copy rather than a spread of the row. Once a model is billing
 * per token every field here is being paid for on every call, and a spread would
 * mean the next column added to `LeadRow` silently joins the prompt.
 *
 * Exported because `TipContext` needs the same narrowing mid-call and there must
 * not be a second one: two functions turning a row into an `AssistantLead` would
 * be two answers to "what does the assistant know about this business", and they
 * would drift on the first column anyone added.
 */
export function leadOf(lead: LeadRow): AssistantLead {
  return {
    id: lead.id,
    name: lead.name,
    city: lead.city,
    phone: lead.phone ?? lead.imprintPhone,
    website: lead.website,
    primaryType: lead.primaryType,
    rating: lead.rating,
    userRatingCount: lead.userRatingCount,
    status: lead.status,
    score: lead.score,
  }
}

/* ------------------------------------------------------------------------- *
 * The builder
 * ------------------------------------------------------------------------- */

export function buildBriefingInput(source: BriefingSource): BriefingInput {
  const { lead, audit, score, timeline, previousCalls, reviews } = source

  const contributions = new Map(
    (score?.breakdown?.factors ?? []).map((factor) => [factor.code, factor.contribution]),
  )

  return {
    lead: leadOf(lead),
    findings: findingsOf(audit, contributions),
    measurements: measurementsOf(audit),
    history: historyOf(lead, timeline, previousCalls),
    reviews: reviews?.items ?? null,
  }
}
