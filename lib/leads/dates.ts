/*
 * Every date the product reads or writes, in one place.
 *
 * `follow_up_at` is a `date`, not a timestamp — the operator schedules a day to
 * ring somebody, not a minute. So every value here is built from the local
 * calendar and formatted by hand: `toISOString()` hands back UTC, and an
 * evening session in Germany would set tomorrow's follow-up to today.
 *
 * Shared rather than server-only because the control that offers the presets is
 * a client component and the queue that reads them back is not. Both halves
 * must agree on what "in a week" means, or the book will show a lead as due a
 * day before the button said it would be. The formatters are here for the same
 * reason in reverse: four surfaces print a date, and four private copies of
 * `dd.mm.yy` is four chances for one of them to be a day out.
 */

/** `2026-08-14` for a Date, in the operator's own day rather than UTC's. */
export function toDateColumn(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Today, optionally shifted. The value every "is it due yet" test compares against. */
export function today(offsetDays = 0): string {
  const now = new Date()
  now.setDate(now.getDate() + offsetDays)
  return toDateColumn(now)
}

/**
 * The three distances the operator actually works in.
 *
 * A month is a calendar month, not thirty days: "call them again next month"
 * means the same date in August, and rounding it to a fixed number of days is
 * the kind of small lie that shows up as a follow-up landing on a Sunday.
 */
export const FOLLOW_UP_PRESETS = [
  { key: '3d', label: '3 days', days: 3 },
  { key: '1w', label: '1 week', days: 7 },
  { key: '1m', label: '1 month', months: 1 },
] as const

export type FollowUpPreset = (typeof FOLLOW_UP_PRESETS)[number]

/** The date a preset resolves to, from today. */
export function presetDate(preset: FollowUpPreset): string {
  const date = new Date()
  if ('days' in preset) date.setDate(date.getDate() + preset.days)
  // setMonth clamps 31.01 + 1 month to 03.03 rather than 28.02, so the day is
  // pinned back afterwards. A follow-up must never skip a month.
  else {
    const day = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + preset.months)
    date.setDate(Math.min(day, daysInMonth(date.getFullYear(), date.getMonth())))
  }
  return toDateColumn(date)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * `14.08.26` — for a date column or a timestamp alike.
 *
 * A bare `2026-08-14` is parsed by hand rather than through `new Date`, which
 * reads it as UTC midnight: west of Greenwich that renders a follow-up a day
 * early, and a queue that is wrong about which day it is has no other job.
 */
export function shortDate(iso: string | null): string {
  if (!iso) return '—'

  const plain = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (plain && iso.length === 10) return `${plain[3]}.${plain[2]}.${plain[1].slice(2)}`

  const date = new Date(iso)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(2)}`
}

/** `30.07.2026, 14:12` — a moment, not a day. For anything with a clock on it. */
export function timestamp(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return (
    `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}` +
    `, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  )
}

/** How near a scheduled day is. Only as far as a working memory needs. */
export function relativeDay(dateColumn: string | null): string | null {
  if (!dateColumn) return null

  const days = Math.round(
    (Date.parse(`${dateColumn}T00:00:00`) - Date.parse(`${today()}T00:00:00`)) / 86_400_000,
  )
  if (!Number.isFinite(days)) return null

  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days < 0) return `${Math.abs(days)}d overdue`
  return `in ${days}d`
}
