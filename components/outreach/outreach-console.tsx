'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'

import { IconAlert, IconClose, IconExternal } from '@/components/icons'
import { FollowUpMenu, StatusMenu, useLeadPatch } from '@/components/leads/lead-controls'
import { AuditMarks } from '@/components/leads/leads-table'
import { ROW_ATTRIBUTE, useRowCursor } from '@/components/shell/keys'
import { StatusStrip } from '@/components/shell/status-strip'
import { CommandLink } from '@/components/ui/command-button'
import { EmptyState } from '@/components/ui/states'
import { FOLLOW_UP_PRESETS, presetDate, relativeDay, shortDate, today } from '@/lib/leads/dates'
import type { LeadRow, OutreachQueues } from '@/lib/leads/types'

/*
 * The morning's work, as two lists.
 *
 * This is not a third view of the book. The book answers "which of my leads
 * match this question"; this answers "what am I doing now", so it is a fixed
 * plan rather than a filterable table, and every row carries the controls to
 * finish with it — status, next date, and the phone number itself. The point is
 * that a session here never has to open a lead: he rings, he sets the status,
 * he picks a date, and the row leaves the queue under him.
 *
 *   Due   — a promise he made himself, arrived. Oldest first, because the one
 *           kept waiting longest is the one to ring.
 *   Cold  — high scorers nobody has touched. Best first, because this queue has
 *           no deadline and the only reason to work it is the top of it.
 *
 * The two are disjoint by construction: a lead carrying a date is in Due or
 * nowhere. Amber throughout — everything on this surface is the book.
 */

/** The snooze `s` performs. A week is the unit a follow-up actually moves in. */
const SNOOZE = FOLLOW_UP_PRESETS.find((preset) => preset.key === '1w')!

function QueueRow({
  lead,
  index,
  showDue,
  busy,
  onCursor,
  onStatus,
  onFollowUp,
}: {
  lead: LeadRow
  /** Position in the whole surface, not in this queue — j and k cross the gap. */
  index: number
  showDue: boolean
  busy: boolean
  onCursor: (index: number) => void
  onStatus: (lead: LeadRow, status: LeadRow['status']) => void
  onFollowUp: (lead: LeadRow, followUpAt: string | null) => void
}) {
  const overdue = lead.followUpAt !== null && lead.followUpAt < today()

  return (
    <tr
      tabIndex={-1}
      {...{ [ROW_ATTRIBUTE]: index }}
      onFocus={() => onCursor(index)}
      className="group text-ink-dim transition-colors focus:bg-raise hover:bg-raise"
    >
      {showDue ? (
        <td className="border-l border-signal py-1.5 pr-2 pl-3 font-data text-micro">
          {/* The date and how far away it is, together: `12.06.26` is a fact and
              `4d overdue` is the reason to pick up the phone. */}
          <span className={overdue ? 'text-signal' : 'text-ink-dim'}>
            {shortDate(lead.followUpAt)}
          </span>
          <span className="ml-1.5 text-ink-faint">{relativeDay(lead.followUpAt)}</span>
        </td>
      ) : null}

      <td
        className={`px-2 py-1.5 text-right font-data text-sm ${
          showDue ? '' : 'border-l border-signal pl-3'
        }`}
      >
        {lead.score === null ? (
          <span className="text-ink-faint" title="Not scored yet">
            —
          </span>
        ) : (
          <span className="text-ink">{lead.score}</span>
        )}
      </td>

      <td className="px-2 py-1.5">
        <div className="flex items-baseline gap-2">
          <Link
            href={`/leads/${lead.id}`}
            className="truncate text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-ink-faint"
            title={lead.name}
          >
            {lead.name}
          </Link>
          {lead.city ? (
            <span className="shrink-0 font-data text-micro text-ink-faint">{lead.city}</span>
          ) : null}
          {lead.noteCount > 0 ? (
            <span
              className="shrink-0 font-data text-micro text-ink-faint"
              title={`${lead.noteCount} note${lead.noteCount === 1 ? '' : 's'}`}
            >
              {lead.noteCount}n
            </span>
          ) : null}
        </div>
      </td>

      <td className="px-2 py-1.5">
        <AuditMarks lead={lead} />
      </td>

      {/* The number, as a link. On a queue whose entire purpose is ringing
          people, the phone is the primary control, not a detail column. */}
      <td className="px-2 py-1.5 font-data text-sm">
        {lead.phone ? (
          <a
            href={`tel:${lead.phone.replace(/\s+/g, '')}`}
            className="whitespace-nowrap text-ink-dim underline decoration-rule-strong underline-offset-2 transition-colors hover:text-signal"
          >
            {lead.phone}
          </a>
        ) : (
          <span className="label text-ink-faint">No number</span>
        )}
      </td>

      <td className="px-2 py-1.5">
        <StatusMenu
          status={lead.status}
          disabled={busy}
          variant="quiet"
          onPick={(status) => onStatus(lead, status)}
        />
      </td>

      <td className="px-2 py-1.5">
        <FollowUpMenu
          followUpAt={lead.followUpAt}
          disabled={busy}
          variant="quiet"
          onPick={(followUpAt) => onFollowUp(lead, followUpAt)}
        />
      </td>

      <td className="px-2 py-1.5">
        {lead.mapsUri ? (
          <a
            href={lead.mapsUri}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${lead.name} on Google Maps`}
            className="inline-flex text-ink-ghost transition-colors group-hover:text-ink-faint hover:!text-signal"
          >
            <IconExternal className="size-3.5" />
          </a>
        ) : null}
      </td>
    </tr>
  )
}

function Queue({
  headline,
  explanation,
  empty,
  rows,
  total,
  offset,
  showDue,
  busy,
  onCursor,
  onStatus,
  onFollowUp,
}: {
  headline: string
  /** How the queue is computed. Stated on the queue, not in a tooltip. */
  explanation: string
  /** What it means that this one is empty, which is never the same sentence. */
  empty: string
  rows: LeadRow[]
  total: number
  /** Where this queue starts in the surface-wide row index. */
  offset: number
  showDue: boolean
  busy: boolean
  onCursor: (index: number) => void
  onStatus: (lead: LeadRow, status: LeadRow['status']) => void
  onFollowUp: (lead: LeadRow, followUpAt: string | null) => void
}) {
  const columns = showDue ? 8 : 7

  return (
    <section>
      <h2 className="flex flex-wrap items-baseline gap-x-3 border-b border-rule bg-panel px-3 py-1.5">
        <span className="label text-ink-dim">{headline}</span>
        <span className="font-data text-micro text-ink">{total}</span>
        {/* How the queue is computed, on the queue. It is a rule the operator
            set, and a worklist that will not say why something is on it is a
            worklist he has to second-guess. */}
        <span className="hidden text-sm text-ink-faint md:inline">{explanation}</span>
      </h2>

      {rows.length ? (
        <table className="w-full border-collapse text-left">
          <colgroup>
            {showDue ? <col className="w-32" /> : null}
            <col className="w-14" />
            <col className="min-w-[14rem]" />
            <col className="min-w-[11rem]" />
            <col className="w-40" />
            <col className="w-32" />
            <col className="w-28" />
            <col className="w-8" />
          </colgroup>
          <tbody className="divide-y divide-rule border-b border-rule">
            {rows.map((lead, index) => (
              <QueueRow
                key={lead.id}
                lead={lead}
                index={offset + index}
                showDue={showDue}
                busy={busy}
                onCursor={onCursor}
                onStatus={onStatus}
                onFollowUp={onFollowUp}
              />
            ))}
            {total > rows.length ? (
              <tr>
                <td colSpan={columns} className="px-3 py-1.5">
                  <span className="font-data text-micro text-ink-faint">
                    {rows.length} of {total} shown — work these and the rest follow.
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : (
        <p className="border-b border-rule px-3 py-3 text-sm text-ink-faint">{empty}</p>
      )}
    </section>
  )
}

export function OutreachConsole({ queues }: { queues: OutreachQueues }) {
  const router = useRouter()
  const { patch, pending, error, dismissError } = useLeadPatch()

  // One index across both queues, so j walks off the bottom of Due and into the
  // top of Cold rather than stopping at a heading.
  const rows = useMemo(() => [...queues.due, ...queues.cold], [queues.due, queues.cold])

  const { containerRef, setCursor } = useRowCursor({
    count: rows.length,
    onOpen: (index) => {
      const lead = rows[index]
      if (lead) router.push(`/leads/${lead.id}`)
    },
    /*
     * `s` sets the row aside — pushes its follow-up out a week. On a queue that
     * is what "not now" means, and it is the one act frequent enough to deserve
     * a key: everything else is a decision, and a decision is worth a menu.
     */
    onSave: (index) => {
      const lead = rows[index]
      if (lead) void patch(lead.id, { followUpAt: presetDate(SNOOZE) })
    },
  })

  const busy = pending !== null
  const empty = queues.dueTotal === 0 && queues.coldTotal === 0

  return (
    <>
      <StatusStrip
        provenance="book"
        detail={`${queues.dueTotal} due · ${queues.coldTotal} cold`}
      >
        {queues.overdueTotal > 0 ? (
          // The operator's own promise, late. `signal`, never `alert`: nothing
          // has failed, he is simply behind.
          <span className="label text-signal">{queues.overdueTotal} overdue</span>
        ) : null}

        <span
          aria-hidden="true"
          className="hidden font-data text-micro text-ink-faint xl:inline"
          title="j and k move, enter opens, s pushes the follow-up a week"
        >
          j k · enter · s
        </span>
      </StatusStrip>

      {error ? (
        <div className="flex items-start gap-2 border-b border-rule border-l border-l-alert bg-panel px-3 py-2">
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <p className="flex-1 text-sm text-ink-dim">{error}</p>
          <button
            type="button"
            onClick={dismissError}
            aria-label="Dismiss"
            className="p-1 text-ink-faint transition-colors hover:text-ink"
          >
            <IconClose className="size-3.5" />
          </button>
        </div>
      ) : null}

      {empty ? (
        <EmptyState
          headline="Nothing queued"
          body={`A lead lands in Due when the follow-up date you set for it arrives, and in Cold when it scores ${queues.coldFloor} or more and you have not worked it yet. Save some leads and let the audit run.`}
          action={
            <CommandLink href="/leads" variant="primary">
              Go to the book
            </CommandLink>
          }
        />
      ) : (
        /*
          Not a scroll container, deliberately. Every row carries two menus, and
          a menu opening inside an `overflow-auto` box is clipped by it — the
          page scrolls instead, and the dropdowns have the whole viewport.
        */
        <div ref={containerRef} className="flex-1">
          <Queue
            headline="Due"
            explanation="Follow-up dates that have arrived. Oldest promise first."
            empty="No follow-up has come due. Set a date on a lead and it appears here on the day."
            rows={queues.due}
            total={queues.dueTotal}
            offset={0}
            showDue
            busy={busy}
            onCursor={setCursor}
            onStatus={(lead, status) => void patch(lead.id, { status })}
            onFollowUp={(lead, followUpAt) => void patch(lead.id, { followUpAt })}
          />

          <Queue
            headline="Cold"
            explanation={`Scoring ${queues.coldFloor} or more, still new, and no date set.`}
            empty={`Nothing unworked is scoring ${queues.coldFloor} or more. Either you have called them all, or the book needs more in it.`}
            rows={queues.cold}
            total={queues.coldTotal}
            offset={queues.due.length}
            showDue={false}
            busy={busy}
            onCursor={setCursor}
            onStatus={(lead, status) => void patch(lead.id, { status })}
            onFollowUp={(lead, followUpAt) => void patch(lead.id, { followUpAt })}
          />
        </div>
      )}
    </>
  )
}
