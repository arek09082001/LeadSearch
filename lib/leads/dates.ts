/*
 * The product's dates, in one place.
 *
 * Two kinds live in this schema and one formatter cannot serve both.
 * `saved_at`, `audited_at` and `occurred_at` are `timestamptz` — instants, to
 * be read in the operator's own zone. `follow_up_at` is a plain `date`: the day
 * he picked, with no time in it at all. Handing `2026-08-14` to `new Date()`
 * parses it as UTC midnight, so anywhere west of Greenwich a follow-up set for
 * the 14th renders as the 13th. Date-only strings are therefore split, never
 * parsed.
 *
 * Nothing here is server-only: the repository computes "due today" with the
 * same `today()` the follow-up buttons write with, and the two disagreeing by a
 * day is how a queue quietly loses a lead.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** `2026-08-14` — today in the operator's own day rather than UTC's. */
export function today(offsetDays = 0): string {
  const now = new Date()
  now.setDate(now.getDate() + offsetDays)
  return iso(now)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
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
  const base = new Date()
  if (step.months) {
    const day = base.getDate()
    const shifted = new Date(base.getFullYear(), base.getMonth() + step.months, 1)
    shifted.setDate(Math.min(day, daysInMonth(shifted.getFullYear(), shifted.getMonth())))
    base.setTime(shifted.getTime())
  }
  if (step.days) base.setDate(base.getDate() + step.days)
  return iso(base)
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
  const date = new Date(value)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(2)}`
}

/** `14.08.2026, 09:31`. Instants only — a plain date has no time to state. */
export function fullDate(value: string | null | undefined): string {
  if (!value) return '—'
  if (DATE_ONLY.test(value)) return shortDate(value)
  const date = new Date(value)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Whole days between today and a plain date. Negative is in the past.
 *
 * Computed as UTC midnights on both sides so a daylight-saving boundary in
 * between cannot turn 7 days into 6.96 and round it to 6.
 */
export function dayGap(date: string): number {
  if (!DATE_ONLY.test(date)) return 0
  const [year, month, day] = date.split('-').map(Number)
  const now = new Date()
  const from = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.UTC(year, month - 1, day) - from) / 86_400_000)
}

/** `overdue 3d`, `today`, `in 5d` — the follow-up date as a standing. */
export function dueLabel(date: string): string {
  const gap = dayGap(date)
  if (gap === 0) return 'today'
  if (gap < 0) return `overdue ${-gap}d`
  return `in ${gap}d`
}

/** How long ago an instant was, in the coarsest unit that is still true. */
export function ago(instant: string): string {
  const days = Math.floor((Date.now() - new Date(instant).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}
