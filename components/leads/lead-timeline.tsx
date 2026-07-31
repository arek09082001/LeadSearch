import { ChangeMarks } from '@/components/leads/change-marks'
import { fullDate } from '@/lib/leads/dates'
import type { TimelineEntry } from '@/lib/leads/types'

/*
 * What has happened to this lead, in the order it happened.
 *
 * The database keeps three records — a trigger appends every status transition
 * to `lead_activities`, notes are prose in `lead_notes`, and the refresh pass
 * writes what Google changed to `lead_refreshes` — and the operator kept none of
 * them. He worked the lead once, in one order, and the world moved under it
 * while he did. Three lists side by side would make him do the interleaving in
 * his head every time he came back cold, which is exactly the work PRODUCT.md's
 * fourth principle says this page owes him instead.
 *
 * So: one column, newest first, with the kind of line carried by what it says
 * rather than by an icon or a rail. A transition is two statuses and an arrow —
 * terse, because it was written by machinery. A note is his own sentence at
 * full width and full ink, because it is the only thing here anybody thought
 * about. A change is its marks and then the numbers either side of it, because
 * "reviews 94 → 128" is the whole content of that line.
 *
 * No spine, no dots, no cards. A history on a dealing screen is a ruled list
 * with a timestamp column, and the timestamps line up because they are `data`.
 */

/** `status_change` says itself; the rest of the vocabulary needs naming. */
const ACTIVITY_LABEL: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  message: 'Message',
  visit: 'Visit',
  meeting: 'Meeting',
  other: 'Logged',
}

function Line({ entry }: { entry: TimelineEntry }) {
  return (
    <li className="flex items-baseline gap-3 px-3 py-1.5">
      <time
        dateTime={entry.at}
        className="w-32 shrink-0 font-data text-micro text-ink-faint tabular-nums"
      >
        {fullDate(entry.at)}
      </time>

      <div className="min-w-0 flex-1">
        {entry.type === 'status_change' ? (
          <span className="flex flex-wrap items-baseline gap-1.5">
            {/* Where it came from is dim; where it went is the record. */}
            <span className="label text-ink-faint">{entry.statusBefore ?? 'none'}</span>
            <span aria-hidden="true" className="font-data text-micro text-ink-ghost">
              →
            </span>
            <span className="label text-ink">{entry.statusAfter}</span>
          </span>
        ) : entry.kind === 'refresh' ? (
          <span className="flex flex-wrap items-baseline gap-2">
            {entry.changes?.length ? (
              <ChangeMarks codes={entry.changes} at={null} variant="full" />
            ) : (
              // A refresh row with no codes is a failed one. It is still
              // history — it says the snapshot beside it is older than its
              // date suggests — and the sentence beneath says why.
              <span className="label text-ink-faint">Refresh failed</span>
            )}
            {entry.body ? <span className="text-sm text-ink-dim">{entry.body}</span> : null}
          </span>
        ) : entry.kind === 'activity' ? (
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="label text-ink-dim">
              {ACTIVITY_LABEL[entry.type ?? 'other'] ?? entry.type}
            </span>
            {entry.body ? <span className="text-sm text-ink-dim">{entry.body}</span> : null}
          </span>
        ) : (
          // His own words, kept as typed: a note with line breaks in it was
          // written with line breaks in it.
          <p className="max-w-[70ch] text-sm whitespace-pre-wrap text-ink">{entry.body}</p>
        )}
      </div>
    </li>
  )
}

export function LeadTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <>
      <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-dim">
        {entries.length ? `History — ${entries.length}` : 'History'}
      </h2>

      {entries.length ? (
        <ul className="divide-y divide-rule border-b border-rule">
          {entries.map((entry) => (
            <Line key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="max-w-[52ch] border-b border-rule px-3 py-4 text-sm text-ink-dim">
          Nothing recorded yet. Every status change writes itself here, a note you save
          with one sits alongside it, and anything Google changes about this business
          lands here too — so this stays the whole account of the lead, not just of what
          you did to it.
        </p>
      )}
    </>
  )
}
