import type { FindingSeverity } from '@/lib/enrichment/vocabulary'
import type { LeadStatus, WebsiteStatus } from '@/lib/leads/types'
import type { TipTrigger } from '@/lib/assistant/vocabulary'

/*
 * The assistant boundary.
 *
 * Everything above this file — the call surface, the route handlers, the store —
 * is written against these three interfaces and never against a model. Until
 * Phase 17 the only implementation is a mock that reads fixtures, and that is
 * not a placeholder to be replaced but the arrangement the surface is built
 * against: a mock that answers instantly would let a screen be designed that
 * cannot exist once a real call has to wait 900ms for a sentence.
 *
 * THREE DECISIONS SHAPED WHAT FOLLOWS.
 *
 *  1. THE PROVIDERS DO NO I/O OF THEIR OWN. Every input is passed in, fully
 *     assembled. A provider that could read the database would be a provider
 *     that has to be mocked with a database, and the point of the split is that
 *     `generate()` is a function of its argument — runnable in a node session,
 *     runnable against a fixture, arguable without a network.
 *
 *  2. MEASUREMENTS AND JUDGEMENTS STAY APART, all the way up to here. The
 *     briefing input carries `measurements` and `findings` under exactly those
 *     names, because that is the split `lead_audits` and `lead_audit_findings`
 *     draw and the one thing that must not blur on the way to a sales argument.
 *     "PageSpeed 23" is a measurement and can be read aloud; "very slow" is a
 *     judgement this tool made and has to be able to defend.
 *
 *  3. SILENCE IS A VALID ANSWER, and only the tip provider is allowed to give
 *     it — hence `Tip | null` rather than a tip with a confidence on it. A
 *     confidence score would push the decision onto the surface, which would
 *     have to pick a threshold, and the threshold would be picked by whoever was
 *     writing the component that afternoon. The provider decides, once.
 *
 * Nothing here is `server-only`: the call surface is a client component and
 * speaks these types. The registry in `index.ts` is the server-only half.
 */

/* ------------------------------------------------------------------------- *
 * Provenance
 * ------------------------------------------------------------------------- */

/**
 * Where an answer came from, carried on every answer.
 *
 * The columns exist in `call_briefings` and `call_summaries` because a briefing
 * read back in six months has to say whether a human, a fixture or a model wrote
 * it. Stamped by the provider rather than by the store, so a provider cannot be
 * swapped in that forgets to say who it is.
 */
export interface AssistantOrigin {
  /** Registry id: `mock`, `anthropic`. Written verbatim to `provider`. */
  provider: string
  /**
   * The model that answered, or null when no model was involved.
   *
   * Null is the mock's honest answer and must not be filled with a placeholder:
   * `mock` in the provider column and a model name beside it would read, a year
   * from now, as a real generation that has simply been mislabelled.
   */
  model: string | null
  generatedAt: string
}

/**
 * Per-call environment. One field today, and it is the load-bearing one.
 *
 * A tip requested at minute four is worthless at minute five — the conversation
 * has moved — so every request has to be abandonable, and a provider that
 * cannot be aborted would leave the surface holding answers to questions nobody
 * is still asking.
 *
 * Spend is deliberately NOT here yet. The Google boundary passes `authorizeSpend`
 * because a paginating provider must be stoppable between pages; what the
 * equivalent is for a token-billed call is a Phase 17 question, and inventing
 * the hook now would mean designing it against a provider nobody has written.
 * The rule it will have to satisfy is already written down: everything goes
 * through the same ledger `api_usage` holds.
 */
export interface AssistantContext {
  signal?: AbortSignal
}

/* ------------------------------------------------------------------------- *
 * The lead, as the assistant sees it
 * ------------------------------------------------------------------------- */

/**
 * A deliberately smaller thing than `LeadRow`, for the reason `LeadPoint` is.
 *
 * What goes to a provider is what a person would need to open a phone call:
 * who they are, where, what they do, how well they are thought of, and where the
 * relationship stands. The lists, the note count, the fetch timestamps and the
 * twenty audit columns are not that — and once a real provider is billing per
 * token, every field in this type is a field being paid for on every call.
 *
 * Field names are `LeadRow`'s so a briefing and a table row cannot disagree.
 */
export interface AssistantLead {
  id: string
  name: string
  city: string | null
  phone: string | null
  /** Null is the product thesis, not a missing value. See `ProviderPlace`. */
  website: string | null
  primaryType: string | null
  rating: number | null
  userRatingCount: number | null
  status: LeadStatus
  /** 0–100, or null when the lead was deliberately excluded from ranking. */
  score: number | null
}

/**
 * One judgement the audit reached, with the evidence under it.
 *
 * Not `AuditFinding`, which carries `passed` — by the time a briefing is being
 * written the passes have been filtered out, and a shape that can still express
 * "we checked and it was fine" invites a provider to argue from a clean bill of
 * health. Everything in this list is something wrong.
 */
export interface BriefingFinding {
  code: string
  /** The short mark, from the shared vocabulary. */
  mark: string
  label: string
  severity: FindingSeverity
  /** The proof, verbatim from the finding row. `{ score: 23 }`, not "very slow". */
  value: Record<string, unknown> | null
}

/**
 * What was observed, as opposed to what was concluded from it.
 *
 * A short list on purpose: these are the numbers that survive being said out
 * loud to a stranger who can go and check them. Every field is nullable and
 * null means "not known", never "fine".
 */
export interface BriefingMeasurements {
  auditedAt: string | null
  websiteStatus: WebsiteStatus | null
  /** PageSpeed mobile performance, 0–100. Google's number, not this tool's. */
  psiPerformance: number | null
  loadMs: number | null
  copyrightYear: number | null
  platform: string | null
  platformVersion: string | null
}

/**
 * What has already happened with this business.
 *
 * The one input that keeps a briefing from opening a fourth call as if it were
 * the first. `notes` is the operator's own prose, newest first and already
 * truncated by the caller — a provider is not the right place to decide how much
 * of a year of notes is worth reading.
 */
export interface BriefingHistory {
  lastContactedAt: string | null
  /** Completed calls before this one. Zero on a cold lead. */
  previousCalls: number
  /** How the last call was filed, from `calls.outcome`. Free text; see the vocabulary. */
  lastOutcome: string | null
  notes: string[]
}

/* ------------------------------------------------------------------------- *
 * 1. The briefing — before the phone rings
 * ------------------------------------------------------------------------- */

/**
 * One review, with the person who wrote it deliberately absent.
 *
 * Google returns an author's display name, photo and profile link with every
 * review; none of it is fetched into a row and none of it reaches here. The
 * operator needs to know that three reviews mention the parking, not who
 * mentioned it — and once a real provider is behind this boundary, a customer's
 * name would be a stranger's data going into somebody else's model.
 */
export interface BriefingReview {
  rating: number | null
  /** The review as written, never Google's translation of it. */
  body: string | null
  /** Google's own phrasing of the age — "a month ago". What a person would say. */
  relativeAge: string | null
  publishedAt: string | null
}

export interface BriefingInput {
  lead: AssistantLead
  /** Failed findings, worst first. Empty is legitimate and means: sell on something else. */
  findings: BriefingFinding[]
  measurements: BriefingMeasurements
  history: BriefingHistory
  /**
   * What their customers said, when it was worth a request to find out.
   *
   * NULL AND EMPTY ARE DIFFERENT and the distinction is the whole reason this is
   * nullable. Empty means Google was asked and this business has no reviews —
   * which is a thing to say on a call. Null means nobody asked: the ceiling
   * refused, Google did not answer, or the cache had expired and the operator is
   * looking at a briefing prepared without them. A provider must not confuse a
   * business with no reputation for one whose reputation we did not buy.
   *
   * Reviews are fetched on their own Places request, once, at prepare time —
   * see `lib/providers/google-places/reviews.ts` for why they are not part of
   * the details mask every save and refresh already pays for.
   */
  reviews: readonly BriefingReview[] | null
}

/** One fact worth saying, with the finding it came from. */
export interface BriefingPoint {
  /** Two or three words. What the eye lands on. */
  label: string
  /** One sentence, ready to be said. Not a paragraph — this is read while dialling. */
  detail: string
  /**
   * The finding code this point argues from, or null for a point that is not a
   * fault — the business signals, the history, the reason to ring today.
   *
   * Carried so the surface can put a point beside its evidence, and so a claim
   * with no finding under it is visible as one rather than blending in.
   */
  code: string | null
}

export interface BriefingObjection {
  /** What they will say, in their words. */
  objection: string
  /** The answer, in one sentence. */
  reply: string
  /** The live trigger this is the prepared form of, when there is one. */
  trigger: TipTrigger | null
}

/**
 * What the operator reads in the ten seconds before the line connects.
 *
 * Every field is bounded by what can be read at a glance in large type, because
 * DESIGN.md is binding and the constraint it states is the whole shape of this
 * type: a briefing that needs scrolling is a briefing that will be read after
 * the call instead of before it.
 */
export interface Briefing {
  origin: AssistantOrigin
  /** One line: who they are and why they are worth the call. */
  headline: string
  /** The opening, ready to say. One or two sentences. */
  opening: string
  /** Three to five. More than five is a document, and documents do not get read. */
  points: BriefingPoint[]
  objections: BriefingObjection[]
  /** What to ask for before hanging up. One sentence, and always present. */
  ask: string
  /**
   * Claims the audit does not support, named so they do not get made.
   *
   * The field this whole interface would be untrustworthy without. A generated
   * briefing will reach for "you are invisible on Google" whether or not
   * anything measured that, and the operator is going to say it to a stranger
   * who may know better. Naming the overreach is cheaper than catching it live.
   */
  avoid: string[]
}

export interface BriefingProvider {
  generate(input: BriefingInput, ctx?: AssistantContext): Promise<Briefing>
}

/**
 * A briefing as a surface reads it back, with the two ages it depends on.
 *
 * Not part of the provider contract — a provider returns a `Briefing` and knows
 * nothing about rows — but it lives here rather than in the server-only store
 * because the lead page is what renders it, and a client component must be able
 * to name the shape without importing a module that opens a database.
 *
 * `stale` is a comparison between two stored timestamps, never a judgement about
 * the present: the lead has been audited since this was written, so the faults
 * it opens with may no longer be the faults. The same failure the diagnosis page
 * already guards against, one level up and with a phone in the operator's hand.
 */
export interface StoredBriefing {
  id: string
  callId: string
  generatedAt: string
  provider: string
  model: string | null
  briefing: Briefing
  /** When the audit it was written from ran. Null when the lead had none. */
  diagnosisAsOf: string | null
  /** How many reviews it was written with. Null when it was written without them. */
  reviewCount: number | null
  stale: boolean
}

/* ------------------------------------------------------------------------- *
 * 2. The tip — while the line is open
 * ------------------------------------------------------------------------- */

/** Who was speaking. Stored as text; closed here because it is a closed set. */
export type Speaker = 'operator' | 'business' | 'unknown'

/**
 * One line of the call, as the recogniser produced it.
 *
 * `atMs` is milliseconds from `calls.started_at`, not a wall clock. A call is a
 * timeline of its own, and the one question ever asked of a segment is where in
 * that timeline it sits — which stays true whether the clock skewed, whether it
 * crossed midnight, or whether the summary is read a year later.
 */
export interface TranscriptSegment {
  atMs: number
  speaker: Speaker
  text: string
}

/** A tip that was already put on screen, so the next one does not repeat it. */
export interface ShownTip {
  trigger: string
  atMs: number
}

export interface TipContext {
  callId: string
  /** Where the call is now, in milliseconds since it started. */
  atMs: number
  lead: AssistantLead
  /**
   * Whether consent to transcribe has been marked, from `calls.consent_noted`.
   *
   * In the context rather than left to the surface because the assistant is the
   * only thing watching the clock during a call, and consent marked at minute
   * nine was not obtained at minute one. See `consent_not_noted` in the trigger
   * vocabulary — this is the input that trigger exists to read.
   */
  consentNoted: boolean
  /**
   * The briefing already on screen, when there is one.
   *
   * Passed in so the provider can stay quiet about things the operator is
   * already looking at. A tip that repeats a prepared objection is worse than no
   * tip: it costs a glance and returns nothing.
   */
  briefing: Briefing | null
  /**
   * The tail of the transcript, oldest first — the last minute or so, not the
   * whole call. Bounded by the caller because only the caller knows how much of
   * it is still relevant, and because the whole call re-sent every few seconds
   * is the shape of an accidental bill.
   */
  transcript: readonly TranscriptSegment[]
  /** Every tip shown in this call so far. The provider is expected to not repeat itself. */
  alreadyShown: readonly ShownTip[]
}

/**
 * One thing worth interrupting for.
 *
 * `body` is short by contract, not by convention: it is read in one glance, in
 * large type, by somebody who is mid-sentence. The bound is stated on the mock
 * and will be stated in the real provider's prompt; the surface should truncate
 * rather than trust, because a provider that ignores it must not be able to push
 * the layout around during a call.
 */
export interface Tip {
  origin: AssistantOrigin
  trigger: TipTrigger
  body: string
}

export interface TipProvider {
  /**
   * Null means nothing is worth saying, which is the answer most of the time.
   *
   * Not an error, not an empty tip, and not a tip with a low confidence: an
   * assistant that always has something to say is an assistant that gets ignored
   * by minute two, and then it is not there for the one moment it was built for.
   */
  suggest(context: TipContext, ctx?: AssistantContext): Promise<Tip | null>
}

/* ------------------------------------------------------------------------- *
 * 3. The summary — after the line drops
 * ------------------------------------------------------------------------- */

/**
 * What survives the call.
 *
 * This is the half of a conversation that is kept: the transcript is deleted on
 * a fourteen-day clock and this is not, which makes `body` the only record that
 * a call happened at all once the fortnight is up. It is written to be read cold
 * — by the operator, in six months, with no memory of the conversation.
 */
export interface CallSummary {
  origin: AssistantOrigin
  /** Prose. A short paragraph, in the operator's own register, not a bullet list. */
  body: string
  /**
   * Where the lead should move to, or null when the call decided nothing.
   *
   * A SUGGESTION, and the schema says so too: `call_summaries.accepted` is
   * written by the operator, not by the provider. Nothing here moves a lead —
   * a status that changed itself because a model heard "maybe next quarter"
   * would be a book that quietly stopped describing what the operator believes.
   */
  suggestedStatus: LeadStatus | null
  /** One sentence: the next thing to do. Null when there is nothing to do. */
  suggestedNextAction: string | null
}

export interface SummaryProvider {
  summarise(
    transcript: readonly TranscriptSegment[],
    lead: AssistantLead,
    ctx?: AssistantContext,
  ): Promise<CallSummary>
}

/* ------------------------------------------------------------------------- *
 * The three of them, as one thing to hold
 * ------------------------------------------------------------------------- */

/**
 * Three interfaces, one implementation choice.
 *
 * They are separate interfaces because they are separate jobs with separate
 * inputs, and bundled here because the choice between mock and model is made
 * once, in one place, for all three. A build that briefed from a fixture and
 * summarised from a model would be a build whose behaviour nobody could state.
 */
export interface Assistant {
  /** Stable id, written to every `provider` column. */
  readonly id: string
  readonly label: string
  readonly briefing: BriefingProvider
  readonly tip: TipProvider
  readonly summary: SummaryProvider
}

/**
 * An assistant refused or failed. Carries the stage so the surface can say what
 * broke — and, more importantly, so the call can carry on without it.
 *
 * None of the three is load-bearing: a call with no briefing is a cold call, a
 * call with no tips is a call, and a call with no summary is a note to write by
 * hand. Every caller is expected to treat this as a degraded surface rather than
 * as a failed operation.
 */
export class AssistantError extends Error {
  readonly stage: 'briefing' | 'tip' | 'summary'
  readonly status?: number

  constructor(stage: AssistantError['stage'], message: string, status?: number) {
    super(message)
    this.name = 'AssistantError'
    this.stage = stage
    this.status = status
  }
}
