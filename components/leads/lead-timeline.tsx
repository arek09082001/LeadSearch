import { STATUS_TONE } from '@/components/leads/tone'
import { timestamp } from '@/lib/leads/dates'
import type { ActivityType, TimelineEntry } from '@/lib/leads/types'

/*
 * What has happened to this lead, in the order it happened.
 *
 * Two tables feed it — the notes he wrote and the outreach log the status
 * trigger has been filling since the first save — and they are shown as one
 * sequence rather than side by side. That is the whole point of the component:
 * "moved to contacted" and "receptionist said ring Tuesday" are one event
 * remembered in two rows, and a page that lists them in separate columns makes
 * the operator re-assemble his own history every time he opens a lead cold.
 *
 * Read newest first, like the audit history beside it. The most recent thing
 * that happened is what he needs before he dials; the rest is context he scrolls
 * to only if the call goes somewhere.
 */

/** What each logged act is called out loud. `status_change` names itself below. */
const ACTIVITY_LABEL: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  message: 'Message',
  visit: 'Visit',
  meeting: 'Meeting',
  status_change: 'Status',
  other: 'Logged',
}

function Entry({ entry }: { entry: TimelineEntry }) {
  return (
    <li className="flex gap-3 px-3 py-2">
      {/* The stamp is the spine of the list: one mono column the eye runs down
          to place everything else in time. */}
      <span className="w-28 shrink-0 font-data text-micro text-ink-faint">
        {timestamp(entry.at)}
      </span>

      <div className="min-w-0 flex-1">
        {entry.kind === 'note' ? (
          <>
            <p className="max-w-[70ch] text-sm whitespace-pre-wrap text-ink-dim">{entry.body}</p>
            {entry.editedAt ? (
              <p className="mt-0.5 font-data text-micro text-ink-faint">
                edited {timestamp(entry.editedAt)}
              </p>
            ) : null}
          </>
        ) : entry.type === 'status_change' ? (
          /*
           * The transition, not the outcome. "contacted" alone would be the
           * same line every time he moved a lead there; `new → contacted` says
           * what actually changed, which is the only reason to keep the log.
           */
          <p className="flex flex-wrap items-baseline gap-1.5">
            <span className="label text-ink-faint">Status</span>
            <span className="label text-ink-faint">{entry.statusBefore ?? 'unset'}</span>
            <span aria-hidden="true" className="font-data text-micro text-ink-faint">
              →
            </span>
            <span className={`label ${entry.statusAfter ? STATUS_TONE[entry.statusAfter] : 'text-ink-dim'}`}>
              {entry.statusAfter ?? 'unset'}
            </span>
          </p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="label shrink-0 text-ink-faint">{ACTIVITY_LABEL[entry.type]}</span>
            <span className="max-w-[70ch] text-sm text-ink-dim">{entry.summary ?? '—'}</span>
          </p>
        )}
      </div>
    </li>
  )
}

export function LeadTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <>
      <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-dim">
        History
        {entries.length ? (
          <span className="ml-2 font-data text-micro normal-case text-ink-faint">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        ) : null}
      </h2>

      {entries.length ? (
        <ul className="divide-y divide-rule border-b border-rule">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="border-b border-rule px-3 py-3 text-sm text-ink-faint">
          Nothing recorded yet. Notes appear here, and every status change writes
          itself in as you make it.
        </p>
      )}
    </>
  )
}
