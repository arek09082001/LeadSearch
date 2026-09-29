import { dateFrom, today } from '@/lib/leads/dates'

/*
 * What an assistant is allowed to write into a follow-up date, and what that
 * turns into.
 *
 * `leads.follow_up_at` is a `date` — a day on a calendar with no time in it —
 * and `lib/leads/dates.ts` explains at length why that distinction is
 * load-bearing rather than an accident of an early migration. Everything in
 * this file exists to hold that line at the one door where the input is not a
 * date picker but a sentence a model produced.
 *
 * FOUR SHAPES, and the list is closed on purpose:
 *
 *   "2026-08-04"            a day, already in the column's own form
 *   "2026-08-04T17:30:00Z"  an instant, reduced to the day it falls on
 *   "today" / "tomorrow"    the two words a model reaches for first
 *   "+3d"                   an offset, which is how a callback is actually agreed
 *
 * A model asked for a date will otherwise produce "next Tuesday", "in a
 * fortnight", "04.08.2026" and "August 4th", and every one of those is a guess
 * about what somebody meant. This module refuses them by name instead: the tool
 * returns a sentence saying which four forms it takes, the model reads it and
 * sends one of them. A wrong date in this column is a business rung on a day
 * nobody agreed to, and it is silent — nothing about the lead says the date was
 * inferred rather than chosen.
 *
 * THE ZONE IS THE OPERATOR'S, NEVER THE HOST'S. On Vercel the server is UTC, so
 * "today" evaluated there is yesterday for the two hours after midnight in
 * Germany. Both functions below resolve through `lib/leads/dates.ts`, which is
 * the same clock the follow-up buttons in the browser and the "due today" query
 * in the repository already share. A fourth notion of "today" living here would
 * be the bug that file was written to prevent.
 */

/** `2026-08-04`, the shape the column stores and `today()` returns. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `+3d`, and `+0d` and `-1d` with it.
 *
 * The sign is optional so `3d` works, because a model that has been told "+3d"
 * will sometimes send the number without it. Negative is allowed rather than
 * rejected: a follow-up in the past is a legitimate thing to write — it is how
 * something lands at the top of the overdue queue on purpose — and refusing it
 * here would be this module inventing a rule the product does not have.
 */
const OFFSET = /^([+-]?)(\d{1,4})d$/i

/**
 * Bounded, and the bound is about typos rather than about calendars.
 *
 * `+3650d` is a decade out and is far more likely to be a model that meant days
 * and produced hours than an operator planning the 2036 season. Ten years is
 * past anything the outreach queue is for, so the ceiling costs nothing real and
 * catches the one mistake that would otherwise sit in the book unnoticed.
 */
const MAX_OFFSET_DAYS = 3_650

export class FollowUpFormatError extends Error {}

/**
 * The sentence every tool description and every rejection quotes.
 *
 * One string, so the error a model reads and the schema it was given cannot
 * describe different things — which is the failure mode that has a model
 * retrying the same rejected value because the error named a form the
 * description did not.
 */
export const FOLLOW_UP_FORMATS =
  'a date ("2026-08-04"), an ISO timestamp, "today", "tomorrow", or a day offset like "+3d"'

/**
 * One follow-up input, as the day it means. `null` clears the date.
 *
 * `undefined` in, `undefined` out, and that is the whole of how "leave it alone"
 * is told apart from "clear it". Every caller here patches a subset of columns,
 * so the two have to stay distinguishable all the way to the update payload —
 * collapsing them would make every status change also wipe a follow-up.
 *
 * Throws rather than falling back to a default. There is no safe guess for a
 * date: writing today's when the model meant next month puts a business at the
 * top of the queue, and writing null when it meant a day loses the callback
 * entirely. Both are silent, so the loud answer is the only correct one.
 */
export function parseFollowUpAt(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null

  const trimmed = value.trim()
  // An empty string is what a cleared text field sends, and the only thing it
  // can honestly mean is the same as null.
  if (!trimmed) return null

  const lowered = trimmed.toLowerCase()
  if (lowered === 'today') return today()
  if (lowered === 'tomorrow') return today(1)

  const offset = OFFSET.exec(lowered)
  if (offset) {
    const days = Number(offset[2])
    if (days > MAX_OFFSET_DAYS) {
      throw new FollowUpFormatError(
        `${trimmed} is more than ten years out. Give a date if that is really the day you mean.`,
      )
    }
    return today(offset[1] === '-' ? -days : days)
  }

  // Already a day. Checked for existence rather than trusted: `2026-02-31`
  // matches the shape, and Postgres would reject it with an error about the
  // column that says nothing about which argument was wrong.
  if (DATE_ONLY.test(trimmed)) {
    if (!isRealDay(trimmed)) {
      throw new FollowUpFormatError(`${trimmed} is not a day that exists.`)
    }
    return trimmed
  }

  /*
   * An instant — and the shape is checked against a regex before `new Date`
   * ever sees it, which is the single most important line in this file.
   *
   * `new Date("04.08.2026")` does not fail. V8 reads it as the 8th of APRIL, and
   * in a German market `04.08.2026` is the 4th of August — four months of
   * difference, arrived at silently, written to a column nothing marks as
   * inferred. The operator finds out when he rings a business in April about a
   * callback agreed for August. `new Date` is lenient by specification and will
   * take "August 4th", "8/4/2026" and "Tue Aug 04 2026" with equal confidence,
   * and every one of those is a guess about what somebody meant.
   *
   * So: ISO-8601 or nothing. A form this refuses comes back as a sentence
   * naming the four it takes, and the model sends one of them.
   */
  const instant = ISO_INSTANT.exec(trimmed)
  if (!instant) {
    throw new FollowUpFormatError(
      `${trimmed} is not a date this tool understands. Give ${FOLLOW_UP_FORMATS}. ` +
        'Note that a date like 04.08.2026 is ambiguous and is not accepted.',
    )
  }

  const [, day, zone] = instant
  if (!isRealDay(day)) {
    throw new FollowUpFormatError(`${day} is not a day that exists.`)
  }

  /*
   * NO ZONE, NO CONVERSION.
   *
   * `2026-08-04T23:30` names a wall clock without saying whose, and JavaScript
   * resolves that against the HOST's — which on Vercel is UTC, so half past
   * eleven at night would become half past one the following morning in Berlin
   * and the day would move. Nobody writing that string meant the 5th. The date
   * part is already the day they named, so it is taken verbatim and no clock is
   * consulted at all.
   *
   * With a zone it is a real instant, and then the day it falls on in the
   * operator's zone is the only correct answer: `2026-08-04T23:30:00Z` IS the
   * 5th in Berlin. `dateFrom(instant, 0)` is that reduction, and it is the same
   * function the call summary uses to turn a provider's offset into a callback
   * day, so the two cannot drift.
   */
  if (!zone) return day
  return dateFrom(new Date(trimmed).toISOString(), 0)
}

/**
 * ISO-8601, and deliberately only ISO-8601.
 *
 * A space instead of the `T` is tolerated because Postgres writes timestamps
 * that way and a value round-tripped out of the database should go back in.
 * Seconds and fractions are optional; the zone is optional and its presence
 * changes the meaning — see the note above.
 */
const ISO_INSTANT =
  /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/i

/**
 * Does this calendar day exist.
 *
 * Round-tripped through UTC rather than parsed and compared field by field:
 * `Date.UTC(2026, 1, 31)` rolls into March, so a day that survives the trip
 * unchanged is a day that is really there. UTC throughout, because this is
 * arithmetic on a label and never a question about an instant.
 */
function isRealDay(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number)
  const stamp = new Date(Date.UTC(year, month - 1, day))
  return (
    stamp.getUTCFullYear() === year &&
    stamp.getUTCMonth() === month - 1 &&
    stamp.getUTCDate() === day
  )
}
