import { LEAD_STATUSES, type LeadStatus } from '@/lib/leads/types'
import { MAX_TIP_WORDS, condense } from '@/lib/assistant/triggers'
import { TIP_TRIGGERS, isTipTrigger, type TipTrigger } from '@/lib/assistant/vocabulary'
import type {
  Briefing,
  BriefingObjection,
  BriefingPoint,
  CallSummary,
  Tip,
} from '@/lib/assistant/types'
import { AssistantError } from '@/lib/assistant/types'

/*
 * The shape the model must answer in, stated twice.
 *
 * ONCE AS A SCHEMA THE API ENFORCES, once as a check this code runs before
 * anything is stored, and the second one is not redundant. Structured outputs
 * guarantee the JSON parses and that every property is the declared type; they
 * do not guarantee that `headline` has words in it, that `points` has three of
 * them rather than nineteen, or that `body` is twelve words. Half of what makes
 * a briefing usable is a bound a JSON schema cannot express — `minLength`,
 * `maxItems` and every numeric constraint are unsupported — so the bounds live
 * here, in code, and a response that misses them is an error rather than a
 * half-filled briefing.
 *
 * THE ENUMS ARE BUILT PER REQUEST WHERE THEY CAN BE. `BriefingPoint.code` is
 * enumerated over the finding codes that were actually sent, so a point cannot
 * cite a fault this lead does not have — the model is prevented from inventing
 * evidence rather than asked not to. Same for the trigger vocabulary and the
 * status list, which are closed sets this product owns.
 *
 * NULL IS A SENTINEL, NOT A TYPE, and that is a deliberate narrowing. Nullable
 * fields are expressible in a JSON schema, and they are also the part of one
 * that models handle least consistently under pressure. Every optional field
 * here is instead a value inside its own domain — the empty string for "no
 * finding", -1 days for "nothing was agreed" — which cannot be malformed,
 * cannot be omitted, and is mapped back to null in exactly one place below.
 */

/* ------------------------------------------------------------------------- *
 * The bounds a schema cannot state
 * ------------------------------------------------------------------------- */

/** `Briefing.points` — "three to five. More than five is a document." */
const MIN_POINTS = 1
const MAX_POINTS = 5
/** More than this is a screen the operator scrolls, which means one he skips. */
const MAX_OBJECTIONS = 5
const MAX_AVOID = 5
/** One line, read at a glance in large type. Generous; a bound, not a target. */
const MAX_LINE = 240
/** Prose, and prose may be a paragraph. The route stores no more than this. */
const MAX_SUMMARY_BODY = 4_000

/** "Nothing here" — the one value every optional string field uses. */
export const NONE = ''
/** "No callback was agreed." Not 0: a call back this afternoon is a real answer. */
export const NO_FOLLOW_UP = -1
/** Stated to the model as well as enforced here, so the two agree. */
export const BOUNDS = { MIN_POINTS, MAX_POINTS, MAX_OBJECTIONS, MAX_AVOID, MAX_TIP_WORDS }

/* ------------------------------------------------------------------------- *
 * Schemas
 * ------------------------------------------------------------------------- */

/**
 * Every object closed, every property required.
 *
 * `additionalProperties: false` and a complete `required` list are what strict
 * schema enforcement needs; without them the guarantee is that the fields
 * present are well typed, not that the fields are present.
 */
function object(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }
}

const STRING = { type: 'string' } as const

function enumOf(values: readonly string[]) {
  return { type: 'string', enum: [...values] }
}

/**
 * The briefing schema, narrowed by the findings this lead actually has.
 *
 * `codes` is the list from `BriefingInput.findings`. Passing it in is what turns
 * "please only cite real findings" from an instruction into a constraint.
 */
export function briefingSchema(codes: readonly string[]) {
  return object({
    headline: STRING,
    opening: STRING,
    points: {
      type: 'array',
      items: object({
        label: STRING,
        detail: STRING,
        // The empty string is the whole point: a briefing's best points are
        // often the ones with no fault under them — the business signals, the
        // history, the reason to ring today.
        code: enumOf([NONE, ...codes]),
      }),
    },
    objections: {
      type: 'array',
      items: object({
        objection: STRING,
        reply: STRING,
        trigger: enumOf([NONE, ...TIP_TRIGGERS]),
      }),
    },
    ask: STRING,
    avoid: { type: 'array', items: STRING },
  })
}

export const TIP_SCHEMA = object({
  // The empty string is silence, and silence is the answer most of the time.
  trigger: enumOf([NONE, ...TIP_TRIGGERS]),
  body: STRING,
})

export const SUMMARY_SCHEMA = object({
  body: STRING,
  suggestedStatus: enumOf([NONE, ...LEAD_STATUSES]),
  suggestedNextAction: STRING,
  suggestedFollowUpDays: { type: 'integer' },
})

/* ------------------------------------------------------------------------- *
 * Reading an answer back
 * ------------------------------------------------------------------------- */

function fail(stage: AssistantError['stage'], what: string): never {
  throw new AssistantError(stage, `The assistant answered in a shape this app cannot use: ${what}.`)
}

/** A line with something on it, trimmed, bounded. Empty is a failure, not a blank. */
function line(stage: AssistantError['stage'], value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) fail(stage, `${field} was empty`)
  return text.slice(0, MAX_LINE)
}

function optionalLine(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === NONE ? null : text.slice(0, MAX_LINE)
}

function array(stage: AssistantError['stage'], value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(stage, `${field} was not a list`)
  return value
}

/**
 * The briefing, checked and narrowed.
 *
 * `origin` is not read from the answer and never could be: who generated a
 * briefing and when is a fact about this process, and a model asked to report it
 * would be a model that could get it wrong. `types.ts` says the provider stamps
 * it, and this is the provider.
 *
 * Points and objections that cite a code or a trigger outside the vocabulary are
 * DROPPED rather than rejected — strict enums make that near-impossible, and
 * losing one line of a briefing is a better failure than losing the briefing.
 * The three lines a briefing cannot be without are checked instead.
 */
export function readBriefing(value: unknown, origin: Briefing['origin']): Briefing {
  const stage = 'briefing' as const
  const raw = (value ?? {}) as Record<string, unknown>

  const points: BriefingPoint[] = array(stage, raw.points, 'points')
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      const label = optionalLine(row.label)
      const detail = optionalLine(row.detail)
      if (!label || !detail) return null
      return { label, detail, code: optionalLine(row.code) }
    })
    .filter((point): point is BriefingPoint => point !== null)
    .slice(0, MAX_POINTS)

  if (points.length < MIN_POINTS) fail(stage, 'it had no points to make')

  const objections: BriefingObjection[] = array(stage, raw.objections, 'objections')
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      const objection = optionalLine(row.objection)
      const reply = optionalLine(row.reply)
      if (!objection || !reply) return null
      const trigger = typeof row.trigger === 'string' ? row.trigger : NONE
      return {
        objection,
        reply,
        trigger: isTipTrigger(trigger) ? trigger : null,
      }
    })
    .filter((entry): entry is BriefingObjection => entry !== null)
    .slice(0, MAX_OBJECTIONS)

  return {
    origin,
    headline: line(stage, raw.headline, 'headline'),
    opening: line(stage, raw.opening, 'opening'),
    points,
    objections,
    ask: line(stage, raw.ask, 'ask'),
    avoid: array(stage, raw.avoid, 'avoid')
      .map((entry) => optionalLine(entry))
      .filter((entry): entry is string => entry !== null)
      .slice(0, MAX_AVOID),
  }
}

/**
 * The tip, or silence.
 *
 * `condense` runs here, on the model's words, exactly as it runs on a fixture's
 * and on a briefing's. `MAX_TIP_WORDS` is enforced in code because a word limit
 * a model is merely told about is not a limit — and the one call where it would
 * be ignored is the one where the model had most to say, which is the call the
 * operator can least afford a paragraph on.
 */
export function readTip(value: unknown, origin: Tip['origin']): Tip | null {
  const raw = (value ?? {}) as Record<string, unknown>
  const trigger = typeof raw.trigger === 'string' ? raw.trigger : NONE

  if (!isTipTrigger(trigger)) return null

  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  // A trigger with nothing to say about it is silence, not an error. The
  // operator gets the prepared objection instead; see `manualTip`.
  if (!body) return null

  return { origin, trigger: trigger as TipTrigger, body: condense(body, MAX_TIP_WORDS) }
}

export function readSummary(value: unknown, origin: CallSummary['origin']): CallSummary {
  const stage = 'summary' as const
  const raw = (value ?? {}) as Record<string, unknown>

  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  if (!body) fail(stage, 'the summary was empty')

  const status = typeof raw.suggestedStatus === 'string' ? raw.suggestedStatus : NONE
  const days = raw.suggestedFollowUpDays

  return {
    origin,
    body: body.slice(0, MAX_SUMMARY_BODY),
    suggestedStatus: LEAD_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : null,
    suggestedNextAction: optionalLine(raw.suggestedNextAction),
    /*
     * `NO_FOLLOW_UP` is the ordinary answer, and so is anything out of range.
     *
     * A year out is not a follow-up, it is a model that has lost the thread, and
     * the bound is checked rather than requested for the same reason the word
     * limit is: what comes back becomes a real day in `call_summaries` and then
     * a real row in the operator's follow-up queue. Out of range collapses to
     * null — "nothing was agreed" — rather than to a clamped date, because a
     * date this app invented is the one thing that must not appear there.
     */
    suggestedFollowUpDays:
      typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 365 ? days : null,
  }
}
