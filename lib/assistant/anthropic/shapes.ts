import { LEAD_STATUSES, type LeadStatus } from '@/lib/leads/types'
import { MAX_TIP_WORDS, condense } from '@/lib/assistant/triggers'
import {
  PREPARABLE_TRIGGERS,
  TIP_TRIGGERS,
  isTipTrigger,
  type TipTrigger,
} from '@/lib/assistant/vocabulary'
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
/** A caption he READS at a glance in large type: the headline, a point's label. */
const MAX_CAPTION = 240
/**
 * A line he SAYS out loud, or a note written the way one is.
 *
 * WHY THIS IS NOT 240 AS WELL. It was, and 240 is the length of a caption rather
 * than of a sentence somebody speaks. The prompt specifies the opening as three
 * moves — who he is, the one checkable thing he found, and a question — and
 * three moves in German do not fit in 240 characters. So what came back was cut
 * at the character: "…oder hat sich seit der Erstellung einfach niemand meh".
 * That is not a shorter opening, it is half a sentence he cannot say, and he
 * finds out which it is with the phone already ringing.
 *
 * A BOUND IS STILL WANTED, because what it guards against is real: a model
 * having a bad day puts a paragraph where a sentence goes, and this card is read
 * at a glance. Six hundred characters is around four German sentences — well
 * past the one or two the prompt asks for, well short of a document.
 */
const MAX_SPOKEN = 600
/** Prose, and prose may be a paragraph. The route stores no more than this. */
const MAX_SUMMARY_BODY = 4_000

/** "Nothing here" — the one value every optional string field uses. */
export const NONE = ''
/** "No callback was agreed." Not 0: a call back this afternoon is a real answer. */
export const NO_FOLLOW_UP = -1
/** Stated to the model as well as enforced here, so the two agree. */
export const BOUNDS = {
  MIN_POINTS,
  MAX_POINTS,
  MAX_OBJECTIONS,
  MAX_AVOID,
  MAX_TIP_WORDS,
  MAX_SPOKEN,
}

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
        /*
         * The preparable half of the vocabulary, not all of it.
         *
         * The clock triggers are removed here for the same reason they are
         * removed from the prompt's trigger list: `composeTip` will not draw a
         * card from a reply filed under one, so offering the category would let
         * the model spend one of five objection slots on an answer that can
         * never reach the screen. The schema is where a rule like that gets
         * enforced rather than requested — see the note at the top.
         */
        trigger: enumOf([NONE, ...PREPARABLE_TRIGGERS]),
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

/** Where a sentence finished: a terminator, any closing quote, then a break. */
const SENTENCE_END = /[.!?…]["'»“]?(?=\s|$)/g

/**
 * Bounded, and never cut in the middle of a sentence.
 *
 * THE HALF THAT MATTERS MORE THAN THE NUMBER. Every field this runs on is either
 * read aloud to a stranger or is a note about what to say to one, and half a
 * sentence is worse than a missing one: he starts saying it and stops. So an
 * overrun keeps the sentences that finished inside the bound and drops the rest,
 * which leaves something he can still say.
 *
 * When not even one sentence fits — a model answering in a single very long
 * clause — it falls back to whole words and marks the cut with an ellipsis. That
 * is the rule `condense` already applies to a tip, and for its reason: visibly
 * truncated rather than quietly reworded, so a line that needs rewriting looks
 * like one instead of reading as a sentence the model chose to end there.
 */
function bounded(text: string, max: number): string {
  if (text.length <= max) return text

  const head = text.slice(0, max)

  let end = 0
  for (const match of head.matchAll(SENTENCE_END)) {
    if (match.index !== undefined) end = match.index + match[0].length
  }
  if (end > 0) return head.slice(0, end)

  const lastSpace = head.lastIndexOf(' ')
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`
}

/**
 * A line with something on it, trimmed, bounded. Empty is a failure, not a blank.
 *
 * `max` is passed at every call site rather than defaulted, because the whole of
 * the bug this replaces was one number standing in for two different kinds of
 * field. A caller has to say which kind it is holding.
 */
function line(
  stage: AssistantError['stage'],
  value: unknown,
  field: string,
  max: number,
): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) fail(stage, `${field} was empty`)
  return bounded(text, max)
}

function optionalLine(value: unknown, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === NONE ? null : bounded(text, max)
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
      // The label is a caption for him; the detail is the sentence he says.
      const label = optionalLine(row.label, MAX_CAPTION)
      const detail = optionalLine(row.detail, MAX_SPOKEN)
      if (!label || !detail) return null
      return { label, detail, code: optionalLine(row.code, MAX_CAPTION) }
    })
    .filter((point): point is BriefingPoint => point !== null)
    .slice(0, MAX_POINTS)

  if (points.length < MIN_POINTS) fail(stage, 'it had no points to make')

  const objections: BriefingObjection[] = array(stage, raw.objections, 'objections')
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      // Both spoken: one is their sentence, the other is his answer to it.
      const objection = optionalLine(row.objection, MAX_SPOKEN)
      const reply = optionalLine(row.reply, MAX_SPOKEN)
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
    // A caption, and then the two things he actually says.
    headline: line(stage, raw.headline, 'headline', MAX_CAPTION),
    opening: line(stage, raw.opening, 'opening', MAX_SPOKEN),
    points,
    objections,
    ask: line(stage, raw.ask, 'ask', MAX_SPOKEN),
    // Notes to him rather than to them, but written as sentences and bounded
    // as ones: a warning cut in half is a warning he has to guess at.
    avoid: array(stage, raw.avoid, 'avoid')
      .map((entry) => optionalLine(entry, MAX_SPOKEN))
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
    suggestedNextAction: optionalLine(raw.suggestedNextAction, MAX_SPOKEN),
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
