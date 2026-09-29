/*
 * The product's dates, in one place, in one timezone.
 *
 * Two kinds live in this schema and one formatter cannot serve both.
 * `saved_at`, `audited_at` and `occurred_at` are `timestamptz` — instants, to
 * be read in the operator's own zone. `follow_up_at` is a plain `date`: the day
 * he picked, with no time in it at all. Handing `2026-08-14` to `new Date()`
 * parses it as UTC midnight, so anywhere west of Greenwich a follow-up set for
 * the 14th renders as the 13th. Date-only strings are therefore split, never
 * parsed.
 *
 * THE ZONE IS EXPLICIT, and that is the load-bearing decision here.
 *
 * Nothing in this file may use the host's local time. This module runs in two
 * places that are in different zones: the browser, which is on the operator's
 * desk in Germany, and the server, which on Vercel is UTC. The repository
 * computes "due today" with the same `today()` that the follow-up buttons write
 * with — so if those two disagreed by a day, a follow-up set for tomorrow
 * evening would appear in the queue tonight, and one set for today would fall
 * out of it at 01:00. Between 00:00 and 02:00 Berlin time, "today" in UTC is
 * still yesterday.
 *
 * The same disagreement shows up a second way: these formatters run during
 * server rendering and again during hydration, so a host-local `shortDate` puts
 * one date in the HTML and a different one in the DOM.
 *
 * So every function below resolves its calendar through `OPERATOR_TIME_ZONE`.
 * One operator, one zone, stated once — and overridable for the day he moves.
 */

/**
 * The zone the operator's days are measured in.
 *
 * `NEXT_PUBLIC_` because both halves must agree and the browser is one of them;
 * it is a preference, not a credential. Read through the bundler's literal
 * substitution rather than `lib/env.ts`, which is for variables the app cannot
 * start without — a missing zone has an obvious right answer and a missing
 * database key does not.
 */
export const OPERATOR_TIME_ZONE =
  process.env.NEXT_PUBLIC_OPERATOR_TIME_ZONE || 'Europe/Berlin'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * An instant, taken apart in the operator's zone.
 *
 * `en-CA` is not a nod to Canada: it is the one widely-supported locale whose
 * numeric format is already ISO, so the parts come back zero-padded and in the
 * order they are wanted. A misconfigured zone would otherwise throw here on
 * every render, so an unknown zone falls back to UTC rather than taking the
 * page down — a date an hour out is a smaller failure than no page.
 */
const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: safeZone(OPERATOR_TIME_ZONE),
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
    return zone
  } catch {
    console.warn(`[dates] Unknown time zone ${zone}; falling back to UTC.`)
    return 'UTC'
  }
}

interface Wall {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** The wall clock in the operator's zone at a given instant. */
function wall(instant: Date): Wall {
  const parts: Record<string, string> = {}
  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some zones render midnight as hour 24 under hour12: false.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function iso(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/**
 * A date-only string as a UTC midnight, for arithmetic only.
 *
 * Never rendered. Calendar arithmetic on days is done in this fixed frame so
 * that a daylight-saving boundary in the middle of a range cannot turn seven
 * days into 6.96 and round it down to six.
 */
function utcMidnight(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function fromUtcMidnight(ms: number): string {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** `2026-08-14` — today in the operator's own day rather than the host's. */
export function today(offsetDays = 0): string {
  const now = iso(wall(new Date()))
  return offsetDays === 0 ? now : fromUtcMidnight(utcMidnight(now) + offsetDays * 86_400_000)
}

/**
 * A plain date `days` after an INSTANT THAT IS NOT NOW.
 *
 * The one date function here that does not start from the clock, and it exists
 * for the one case where starting from the clock would be wrong: a callback
 * agreed on the phone is measured from the end of that call. `today(3)` is the
 * right answer while the operator is still holding the receiver and the wrong
 * one the moment he writes the summary up the following morning — the day would
 * slide forward with him, and the business would be rung on a day nobody named.
 *
 * The instant is reduced to a calendar day in the operator's zone first, exactly
 * as `dayGap` does, so a call that ended at 23:50 counts from that day and not
 * from the UTC tomorrow the server thinks it was.
 */
export function dateFrom(instant: string, days: number): string {
  return fromUtcMidnight(utcMidnight(iso(wall(new Date(instant)))) + days * 86_400_000)
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one. Read in UTC so the
  // host's zone cannot shift it across a boundary.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * A date `step` from today.
 *
 * Months are added by month, then clamped to the length of the month they land
 * in — "one month" from the 31st of January is the 28th of February, not the
 * 3rd of March, which is what plain arithmetic would produce and what the
 * operator would read as a bug.
 */
export function datePlus(step: { days?: number; months?: number }): string {
  const base = wall(new Date())
  let year = base.year
  let month = base.month - 1
  let day = base.day

  if (step.months) {
    const shifted = month + step.months
    year += Math.floor(shifted / 12)
    month = ((shifted % 12) + 12) % 12
    day = Math.min(day, daysInMonth(year, month))
  }

  const anchor = Date.UTC(year, month, day)
  return fromUtcMidnight(anchor + (step.days ?? 0) * 86_400_000)
}

/**
 * The follow-up steps the operator actually uses.
 *
 * Three, not a calendar: the point of the control is that a decision about when
 * to call back costs one click. The date field is still there underneath for
 * the day he has an actual reason to pick.
 */
export const FOLLOW_UP_PRESETS = [
  { key: '3d', label: '3 days', step: { days: 3 } },
  { key: '1w', label: '1 week', step: { days: 7 } },
  { key: '1m', label: '1 month', step: { months: 1 } },
] as const

export type FollowUpPreset = (typeof FOLLOW_UP_PRESETS)[number]

/** `14.08.26`. Handles both an instant and a plain date column. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split('-')
    return `${day}.${month}.${year.slice(2)}`
  }
  const parts = wall(new Date(value))
  return `${pad(parts.day)}.${pad(parts.month)}.${String(parts.year).slice(2)}`
}

/** `14.08.2026, 09:31`. Instants only — a plain date has no time to state. */
export function fullDate(value: string | null | undefined): string {
  if (!value) return '—'
  if (DATE_ONLY.test(value)) return shortDate(value)
  const parts = wall(new Date(value))
  return `${pad(parts.day)}.${pad(parts.month)}.${parts.year}, ${pad(parts.hour)}:${pad(parts.minute)}`
}

/**
 * Whole days between today and a plain date. Negative is in the past.
 *
 * Both sides are reduced to a calendar day in the operator's zone first and
 * subtracted as UTC midnights, so neither the host's zone nor a daylight-saving
 * boundary in between can move the answer.
 */
export function dayGap(date: string): number {
  if (!DATE_ONLY.test(date)) return 0
  return Math.round((utcMidnight(date) - utcMidnight(today())) / 86_400_000)
}

/** `overdue 3d`, `today`, `in 5d` — the follow-up date as a standing. */
export function dueLabel(date: string): string {
  const gap = dayGap(date)
  if (gap === 0) return 'today'
  if (gap < 0) return `overdue ${-gap}d`
  return `in ${gap}d`
}

/**
 * How long ago an instant was, in the coarsest unit that is still true.
 *
 * Counted in calendar days rather than elapsed hours: something written at
 * 23:50 was written yesterday at 00:10 the next morning, not "today", and the
 * operator reading his own history at midnight is the case that catches it.
 */
export function ago(instant: string): string {
  const days = -dayGap(iso(wall(new Date(instant))))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

/** Whole days since an instant, as a number. What a staleness rule compares. */
export function daysSince(instant: string | null | undefined): number | null {
  if (!instant) return null
  return -dayGap(iso(wall(new Date(instant))))
}
