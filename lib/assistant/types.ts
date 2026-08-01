import type { FindingSeverity } from '@/lib/enrichment/vocabulary'
import type { ActivityType, LeadStatus } from '@/lib/leads/types'
import type { CostEvent, ProviderContext } from '@/lib/providers/types'

/*
 * The assistant boundary: what a briefing is made of, and what makes one.
 *
 * Nothing above this file knows whether a briefing was written by a language
 * model, by a rule set, or by the operator's own vocabulary rearranged. That is
 * not politeness towards a future integration — it is the current state of the
 * product. Until the model phase there is no model call, and the only provider
 * that exists composes the briefing from fixtures and from the sentences the
 * audit already wrote. When a model does arrive it satisfies this interface and
 * nothing else moves.
 *
 * TWO HALVES, and the split is the same one `score.ts` and `store.ts` draw:
 *
 *   `BriefingInput`  is built by a PURE function — `briefing-input.ts` — from
 *                    rows already read. No clock, no network, no database. That
 *                    is what makes a briefing arguable: the input can be built
 *                    in a test, printed, and read against what came back.
 *   `Briefing`       is what a provider returns. Structured, never prose: the
 *                    operator is reading it thirty seconds before he dials, and
 *                    a paragraph is not readable in thirty seconds.
 *
 * Both are stored on `call_briefings`, side by side, for the reason
 * `lead_scores.factors` stores the arithmetic rather than only the number.
 */

/* ------------------------------------------------------------------------- *
 * The input
 * ------------------------------------------------------------------------- */

/** The business itself, as opposed to its website. What is said before the pitch. */
export interface BriefingBusiness {
  name: string
  /** The Google category, already formatted for a person — "Dentist", not `dentist`. */
  category: string | null
  city: string | null
  formattedAddress: string | null
  phone: string | null
  website: string | null
  /** Google's star average. The single number an owner is proudest of. */
  rating: number | null
  reviewCount: number | null
}

/** One piece of proof, flattened to something that can be said out loud. */
export interface FindingEvidence {
  label: string
  value: string
}

/**
 * One failed check, carried whole.
 *
 * `message` is verbatim from the audit, which is verbatim from `findings.ts`.
 * Those sentences were written to be said on the phone and have been argued
 * over once already; a provider that rewrites them is losing work, not adding
 * it. What a provider is for is choosing WHICH of them to say and in what
 * order — never restating the fault in worse words.
 */
export interface BriefingFinding {
  code: string
  /** Two or three words, from the shared vocabulary. */
  mark: string
  label: string
  category: string
  severity: FindingSeverity
  message: string
  evidence: FindingEvidence[]
  /** What `config.ts` pays for this fault. Null for a code the vocabulary lost. */
  weight: number | null
  /** What it actually contributed to THIS lead's score. Null when unscored. */
  contribution: number | null
}

/**
 * A check the site passed.
 *
 * Carried for one purpose: the `avoid` list. The single worst thing that can
 * happen on a cold call is opening with a fault the owner can immediately
 * disprove, and the only way to not do that is to know what is already fine.
 * The lead page has said this out loud since it was built — "Passed, do not
 * claim these are wrong" — and a briefing that did not carry it forward would
 * be a briefing that knew less than the page it sits on.
 */
export interface BriefingPass {
  code: string
  mark: string
  message: string
}

export interface BriefingScoreFactor {
  code: string
  label: string
  severity: FindingSeverity
  weight: number
  contribution: number
}

export interface BriefingScore {
  /** 0–100, or null when the scorer deliberately withheld one. */
  score: number | null
  /** Set when `score` is null. Says which rule took the lead out, in words. */
  excluded: { rule: string; reason: string } | null
  /** The faults the number was built from, worst first. */
  factors: BriefingScoreFactor[]
  configVersion: string
  computedAt: string
}

/** One line of what has already happened between the operator and this business. */
export interface BriefingContact {
  at: string
  kind: 'note' | 'activity' | 'refresh'
  type: ActivityType | null
  body: string | null
  statusBefore: LeadStatus | null
  statusAfter: LeadStatus | null
}

/**
 * What has passed between them, which decides whether this is a first call.
 *
 * `attempts` is the number that changes the opener outright: ringing somebody
 * for the fourth time and opening as though it were the first is the mistake
 * this section exists to prevent.
 */
export interface BriefingHistory {
  status: LeadStatus
  attempts: number
  lastContactAt: string | null
  followUpAt: string | null
  savedAt: string
  /** Newest first, capped. Notes and status changes as one sequence. */
  entries: BriefingContact[]
}

/** One review, with the person who wrote it deliberately absent. */
export interface BriefingReview {
  rating: number | null
  body: string | null
  /** Google's own phrasing — "a month ago". What the operator would say. */
  relativeAge: string | null
  publishedAt: string | null
  languageCode: string | null
}

/**
 * Everything a provider is given, and nothing it is not.
 *
 * Deliberately a plain serialisable object: it is stored on the briefing row
 * whole, so what the provider saw is recoverable six weeks later without
 * re-deriving it from tables that have moved on since.
 */
export interface BriefingInput {
  business: BriefingBusiness
  /** Failed checks about how the website WORKS. Worst first. */
  faults: BriefingFinding[]
  /**
   * Failed checks about what the site is required to SAY — the Impressum block.
   *
   * Separated because it is said differently. A missing Impressum is a legal
   * exposure with a deadline attached to it, and it sounds like a warning; a
   * slow server is a lost customer, and it sounds like an opportunity. Mixing
   * the two into one list makes every fault sound like whichever one was said
   * first.
   */
  compliance: BriefingFinding[]
  passed: BriefingPass[]
  score: BriefingScore | null
  /** Whether a phone screenshot exists to look at while the line rings. */
  screenshot: boolean
  history: BriefingHistory
  reviews: BriefingReview[]
  /**
   * Whether reviews were looked for at all.
   *
   * Distinct from an empty `reviews`, which means the business has none — a
   * fact worth mentioning on a call, and the opposite of "we did not ask".
   */
  reviewsFetched: boolean
  /** Three dates, because a briefing is only as current as its worst input. */
  asOf: {
    /** When the Google snapshot in `business` was taken. */
    google: string
    /** When the audit behind `faults` ran. Null when the lead has none. */
    diagnosis: string | null
    /** When the reviews were fetched. Null when they were not. */
    reviews: string | null
  }
}

/* ------------------------------------------------------------------------- *
 * The output
 * ------------------------------------------------------------------------- */

/**
 * One reason to keep listening, in one sentence.
 *
 * `code` points back at the finding it rests on so the surface can put the
 * evidence beside it and the operator can check a claim before he makes it.
 * Null for a hook that rests on something other than a fault — the business's
 * own rating, say.
 */
export interface BriefingHook {
  text: string
  code: string | null
  /**
   * Why it sits where it sits: what this fault is worth on this lead.
   *
   * Carried rather than implied by array order, so a surface can say WHY the
   * amber one is amber, and so a future provider that ranks differently has to
   * state its reasoning in the same currency the scorer uses.
   */
  strength: number
}

/** A number to say out loud. "PageSpeed 23", not "quite slow". */
export interface BriefingEvidence {
  label: string
  value: string
  code: string | null
}

export interface BriefingObjection {
  /** What the owner says. In their words, not the operator's. */
  objection: string
  /** One answer. Not three; he has to say it while they are still talking. */
  answer: string
}

/**
 * The briefing itself. Five fields, all of them short.
 *
 * `opener` is an array of sentences rather than a paragraph because it is read
 * aloud, and a reader's eye needs a place to come back to between breaths. Two
 * or three, and one of them is the consent sentence — a cold B2B call in
 * Germany is made under §7 UWG's presumed-interest test, and stating who is
 * calling and why, immediately, is both the lawful thing and the thing that
 * stops the call being hung up in four seconds.
 */
export interface Briefing {
  opener: string[]
  /** Three to five, strongest first. One sentence each. */
  hooks: BriefingHook[]
  evidence: BriefingEvidence[]
  /** The three most likely, each with one answer. */
  objections: BriefingObjection[]
  /** What will not land on this lead, and why not. */
  avoid: string[]
}

/* ------------------------------------------------------------------------- *
 * The provider
 * ------------------------------------------------------------------------- */

export interface BriefingResult {
  briefing: Briefing
  /**
   * What producing it cost, priced at list.
   *
   * Empty for a provider with no external call. It is on the interface from the
   * first day so that the model provider, when it exists, bills through
   * `api_usage` like every other external call and the cost surface keeps
   * telling the truth without being taught about a new kind of spend.
   */
  cost: CostEvent[]
}

export interface BriefingProvider {
  /** Stable id, written to `call_briefings.provider`. */
  readonly id: string
  readonly label: string
  /** The model behind it, stamped on the row. Null for a provider with none. */
  readonly model: string | null

  prepare(input: BriefingInput, ctx?: ProviderContext): Promise<BriefingResult>
}

/* ------------------------------------------------------------------------- *
 * The stored form
 * ------------------------------------------------------------------------- */

/**
 * A briefing as the lead page reads it back.
 *
 * `stale` is a comparison between two stored timestamps rather than a judgement
 * about the present: the lead has been audited since this was written, so the
 * faults it opens with may no longer be the faults. Same failure the diagnosis
 * already guards against, one level up.
 */
export interface StoredBriefing {
  id: string
  createdAt: string
  provider: string
  model: string | null
  briefing: Briefing
  diagnosisAsOf: string | null
  googleAsOf: string | null
  reviewsAsOf: string | null
  reviewCount: number
  stale: boolean
}
