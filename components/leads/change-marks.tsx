import { DIRECTION_TONE } from '@/components/leads/tone'
import { CHANGE_SPECS, sortChanges } from '@/lib/leads/changes'
import { shortDate } from '@/lib/leads/dates'

/*
 * What the refresh found, as marks.
 *
 * The counterpart to `AuditMarks` in the table, built the same way and for the
 * same reason: one component, rendering one vocabulary, used by every surface
 * that shows a lead. A row that said "Built a site" while the lead's own page
 * said something else about the same refresh would be a correctness bug wearing
 * a styling bug's clothes.
 *
 * These sit beside the business NAME, never in the audit column. That placement
 * is the whole distinction between the two vocabularies — a fault is something
 * wrong with a website, a change is something that happened to a business — and
 * it survives being read at a glance in a way a colour would not.
 *
 * The date is always attached, in the title if not on screen. These marks are
 * sticky: they show the last change the refresh found, which may have been in
 * May, and a mark with no date on it would read as "just now".
 */

/** Beyond this the name column stops being a name column. */
const MAX_MARKS = 2

export function ChangeMarks({
  codes,
  at,
  /** `inline` for a table row, `full` for the lead's own page. */
  variant = 'inline',
}: {
  codes: string[]
  at: string | null
  variant?: 'inline' | 'full'
}) {
  const sorted = sortChanges(codes)
  if (!sorted.length) return null

  const shown = variant === 'full' ? sorted : sorted.slice(0, MAX_MARKS)
  const hidden = sorted.length - shown.length
  const when = at ? shortDate(at) : null

  return (
    <>
      {shown.map((code) => (
        <span
          key={code}
          className={`label shrink-0 ${DIRECTION_TONE[CHANGE_SPECS[code].direction]}`}
          title={when ? `${CHANGE_SPECS[code].label} — found ${when}` : CHANGE_SPECS[code].label}
        >
          {CHANGE_SPECS[code].mark}
        </span>
      ))}
      {hidden > 0 ? (
        <span
          className="shrink-0 font-data text-micro text-ink-faint"
          title={sorted
            .slice(MAX_MARKS)
            .map((code) => CHANGE_SPECS[code].label)
            .join(' · ')}
        >
          +{hidden}
        </span>
      ) : null}
      {variant === 'full' && when ? (
        <span className="shrink-0 font-data text-micro text-ink-faint">{when}</span>
      ) : null}
    </>
  )
}
