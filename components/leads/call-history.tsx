import Link from 'next/link'

import { CALL_HISTORY_LIMIT } from '@/lib/assistant/store'
import type { CallHistoryEntry } from '@/lib/assistant/types'
import { outcomeLabel } from '@/lib/assistant/vocabulary'
import { fullDate } from '@/lib/leads/dates'

/*
 * Every time this business was rung, and what came of it.
 *
 * THE READ SIDE OF THREE COLUMNS THAT WERE BEING WRITTEN INTO THE DARK.
 * `calls.outcome`, `status_before` and `status_after` are filled when the
 * operator takes a summary, and until this panel existed the only thing that
 * ever read them back was the next briefing — a prompt, not a screen. A column
 * that nobody can see is a column that goes wrong quietly, and the first person
 * to notice is whoever eventually tries to answer "is any of this working".
 *
 * A LIST OF ATTEMPTS, NOT OF CONVERSATIONS, because that is what `calls` is.
 * Four rings and one answer is five rows here, and the four that went nowhere
 * are the reason the panel is worth having — "we have tried this business five
 * times" is unrecoverable from a history that only records the successes.
 *
 * SEPARATE FROM THE TIMELINE NEXT DOOR, and deliberately. The calls migration
 * refused to write a `lead_activities` row per ring, on the grounds that it
 * would bury the history the log exists for; folding them in here would be the
 * same mistake one layer up. The timeline is prose he wrote and changes Google
 * made. This is machinery, and it reads like machinery — a timestamp column, a
 * duration, and the summary underneath in his own register.
 *
 * THE SUMMARY IS THE POINT OF THE ROW. Fourteen days after the call it is the
 * entire record of what was said, and a history that listed dates and outcomes
 * over a paragraph that had been deleted would be an index to nothing. So it is
 * at full ink and full width, and everything else on the line is micro type.
 */

/**
 * How long the line was open, as mm:ss.
 *
 * Measured from `started_at`, which `markListening` re-stamps when Start is
 * pressed — so on a call that was actually listened to this is the conversation
 * and not the minute he spent reading the briefing first. A call is minutes
 * long; one that ran past an hour has bigger problems than its clock, which is
 * the same bet the clock on the call surface makes.
 */
function duration(startedAt: string, endedAt: string): string {
  const total = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Where the lead went, when it went anywhere.
 *
 * Rendered only when `status_after` is set, which means the operator took the
 * suggestion — the column is written by that press and by nothing else. Equal
 * statuses are said as "stayed" rather than drawn as an arrow pointing at
 * itself: he did press the button, and the row should not claim a move that did
 * not happen.
 */
function StatusMove({ entry }: { entry: CallHistoryEntry }) {
  if (!entry.statusAfter) return null

  if (entry.statusAfter === entry.statusBefore) {
    return <span className="label text-ink-faint">stayed {entry.statusAfter}</span>
  }

  return (
    <span className="flex items-baseline gap-1.5">
      <span className="label text-ink-faint">{entry.statusBefore ?? 'none'}</span>
      <span aria-hidden="true" className="font-data text-micro text-ink-ghost">
        →
      </span>
      <span className="label text-ink">{entry.statusAfter}</span>
    </span>
  )
}

/**
 * What the operator did with the summary, when it is worth saying.
 *
 * Only the two states that are a gap. A summary he took is already visible as
 * the status move beside it and as the note in the timeline below, so saying
 * "accepted" as well would be the same fact three times. The other two are
 * things nothing else on the page records: one he read and rejected, and one he
 * never looked at — and `accepted` has three states precisely so those two do
 * not get filed as the same thing.
 */
function Verdict({ accepted }: { accepted: boolean | null }) {
  if (accepted === true) return null
  return (
    <span className="label text-ink-ghost">{accepted === false ? 'took nothing' : 'unreviewed'}</span>
  )
}

function Attempt({ entry }: { entry: CallHistoryEntry }) {
  return (
    <li className="flex items-baseline gap-3 px-3 py-1.5">
      <time
        dateTime={entry.startedAt}
        className="w-32 shrink-0 font-data text-micro text-ink-faint tabular-nums"
      >
        {fullDate(entry.startedAt)}
      </time>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {entry.endedAt ? (
            <span className="font-data text-micro text-ink-dim tabular-nums">
              {duration(entry.startedAt, entry.endedAt)}
            </span>
          ) : (
            /*
              Null `ended_at` is a real state and this is what it usually means
              in the past tense: prepared, and either never dialled or never
              stopped. The in-progress reading belongs to the newest row only,
              and the call surface is one click away to settle which.
            */
            <span className="label text-ink-ghost">not closed off</span>
          )}

          {entry.outcome ? (
            <span className="label text-ink-dim">{outcomeLabel(entry.outcome)}</span>
          ) : (
            <span className="label text-ink-ghost">not filed</span>
          )}

          <StatusMove entry={entry} />

          {entry.summary ? <Verdict accepted={entry.summary.accepted} /> : null}

          {/*
            To the call itself, where the tips and — for fourteen days — the
            transcript still are. Last on the line and quiet: it is the way out
            of this page, not a thing to read.
          */}
          <Link
            href={`/calls/${entry.id}`}
            className="label ml-auto text-ink-faint transition-colors hover:text-signal"
          >
            Open
          </Link>
        </div>

        {entry.summary ? (
          /*
            Kept as written, like a note. `wrap-anywhere` for the reason the
            timeline gives: a measured column is only measured until something
            unbreakable lands in it.
          */
          <p className="mt-1 max-w-[70ch] text-sm whitespace-pre-wrap wrap-anywhere text-ink">
            {entry.summary.body}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Rendered only when there is something to render.
 *
 * No empty state, on the argument the briefing panel already makes: a permanent
 * empty block on every lead in the book would be a line to read past a thousand
 * times to be useful forty. A lead that has never been phoned simply has no
 * calls section, and the Prepare button on the strip above is where that starts.
 */
export function CallHistory({ entries }: { entries: CallHistoryEntry[] }) {
  if (!entries.length) return null

  return (
    <>
      <h2 className="label flex items-baseline justify-between gap-3 border-b border-rule bg-panel px-3 py-1.5 text-ink-dim">
        <span>Calls — {entries.length}</span>
        {/*
          Said rather than trailed off. A history that silently stopped at twenty
          would read as a business that had been rung twenty times exactly.
        */}
        {entries.length === CALL_HISTORY_LIMIT ? (
          <span className="text-ink-ghost">most recent {CALL_HISTORY_LIMIT}</span>
        ) : null}
      </h2>

      <ul className="divide-y divide-rule border-b border-rule">
        {entries.map((entry) => (
          <Attempt key={entry.id} entry={entry} />
        ))}
      </ul>
    </>
  )
}
