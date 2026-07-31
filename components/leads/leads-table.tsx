'use client'

import Link from 'next/link'
import type { RefObject } from 'react'

import { IconChevronDown, IconExternal, IconPulse } from '@/components/icons'
import { SEVERITY_TONE, STATUS_TONE } from '@/components/leads/tone'
import { ROW_ATTRIBUTE } from '@/components/shell/keys'
import { Checkbox } from '@/components/ui/controls'
import { FINDING_SPECS, sortCodes } from '@/lib/enrichment/vocabulary'
import { shortDate, today } from '@/lib/leads/dates'
import { formatPlaceType } from '@/lib/places-types'
import { type LeadRow, type LeadSort } from '@/lib/leads/types'

/*
 * The book, as rows.
 *
 * Same field as the search feed and deliberately so — but the strip above says
 * BOOK, the marks are amber rather than green, and every column here is the
 * operator's own work rather than Google's. Principle 4 sets the column list:
 * a lead read cold two months later has to explain itself without the session
 * that produced it, which is why status, score, audit, city, follow-up and note
 * count are all on the row rather than one click inside it.
 *
 * Brightness carries meaning, as on the feed. A fault the operator can sell
 * against sits at full `ink`; a site that passed a check fades back. Nothing
 * here spends `alert` — a business with a bad website is the product working,
 * not something broken.
 */

interface Column {
  key: LeadSort | null
  label: string
  className: string
}

const COLUMNS: Column[] = [
  { key: null, label: '', className: 'w-8 pl-3' },
  { key: 'score', label: 'Score', className: 'w-14 text-right' },
  { key: 'name', label: 'Business', className: 'min-w-[13rem]' },
  { key: 'status', label: 'Status', className: 'w-24' },
  { key: null, label: 'Web', className: 'w-40' },
  { key: 'audited', label: 'Audit', className: 'min-w-[11rem]' },
  { key: 'city', label: 'City', className: 'hidden w-32 lg:table-cell' },
  { key: null, label: 'Category', className: 'hidden w-36 2xl:table-cell' },
  { key: 'follow_up', label: 'Follow-up', className: 'hidden w-24 xl:table-cell' },
  { key: 'saved', label: 'Saved', className: 'hidden w-20 md:table-cell' },
  { key: null, label: '', className: 'w-8' },
]

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Beyond this the column stops being scannable and starts being a paragraph. */
const MAX_MARKS = 4

/**
 * The audit, as marks.
 *
 * Only faults are drawn. A row of green ticks for everything a site got right
 * would fill the widest column on the surface with the one thing the operator
 * is never looking for, and the eye would have to subtract it every pass. The
 * passing checks are all still there — they are on the lead's own page, where
 * "and these are fine" is worth having in front of you on a call.
 *
 * Every mark comes from the shared finding vocabulary rather than from logic
 * restated here, so a row and the diagnosis behind it cannot drift apart.
 */
export function AuditMarks({ lead }: { lead: LeadRow }) {
  if (lead.enrichmentState === 'queued' || lead.enrichmentState === 'running') {
    return (
      <span className="label flex items-center gap-1.5 text-ink-faint">
        <IconPulse className="size-3.5 animate-pulse" />
        {lead.enrichmentState === 'running' ? 'Auditing' : 'Queued'}
      </span>
    )
  }

  if (lead.enrichmentState === 'failed') {
    return (
      <span className="label text-ink-faint" title={lead.enrichmentError ?? undefined}>
        Audit failed
      </span>
    )
  }

  if (!lead.lastAuditedAt) {
    return <span className="label text-ink-faint">Not audited</span>
  }

  const codes = sortCodes(lead.auditFlags)
  const shown = codes.slice(0, MAX_MARKS)
  const hidden = codes.length - shown.length

  /*
   * PageSpeed arrives a stage after everything else, so the row says which of
   * the two it is looking at. A silent gap where a score will be would read as
   * "tested and fine", which is the one thing it does not mean.
   */
  const pending = lead.psiState === 'pending' || lead.psiState === 'running'

  const trailing = (
    <>
      {pending ? (
        <span className="font-data text-micro text-ink-ghost" title="Waiting on Google PageSpeed">
          PS…
        </span>
      ) : lead.psiPerformance !== null ? (
        <span
          className={`font-data text-micro ${lead.psiPerformance < 50 ? 'text-ink-dim' : 'text-ink-faint'}`}
          title={`Google PageSpeed, mobile: ${lead.psiPerformance}/100`}
        >
          PS {lead.psiPerformance}
        </span>
      ) : null}
      {lead.platform ? (
        <span className="font-data text-micro text-ink-faint" title="Detected platform">
          {lead.platform}
          {lead.platformVersion ? ` ${lead.platformVersion}` : ''}
        </span>
      ) : null}
    </>
  )

  if (!shown.length) {
    return (
      <span
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
        title={`Audited ${shortDate(lead.lastAuditedAt)}`}
      >
        <span className="label text-ink-faint">Nothing found</span>
        {trailing}
      </span>
    )
  }

  return (
    <span
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
      title={`Audited ${shortDate(lead.lastAuditedAt)}`}
    >
      {shown.map((code) => (
        <span
          key={code}
          className={`label ${SEVERITY_TONE[FINDING_SPECS[code].severity]}`}
          title={FINDING_SPECS[code].label}
        >
          {FINDING_SPECS[code].mark}
        </span>
      ))}
      {hidden > 0 ? (
        <span
          className="font-data text-micro text-ink-faint"
          title={sortCodes(codes.slice(MAX_MARKS))
            .map((code) => FINDING_SPECS[code].label)
            .join(' · ')}
        >
          +{hidden}
        </span>
      ) : null}
      {trailing}
    </span>
  )
}

export function LeadsTable({
  rows,
  selected,
  onSelect,
  sort,
  desc,
  onSort,
  containerRef,
  onCursor,
}: {
  rows: LeadRow[]
  selected: Set<string>
  onSelect: (next: Set<string>) => void
  sort: LeadSort
  desc: boolean
  onSort: (key: LeadSort) => void
  /** The scroll box the keyboard cursor searches for rows inside. */
  containerRef?: RefObject<HTMLDivElement | null>
  /** Clicking or tabbing to a row moves the cursor there too, so j/k continues from it. */
  onCursor?: (index: number) => void
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someSelected = !allSelected && rows.some((row) => selected.has(row.id))
  const now = today()

  function toggleRow(id: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    onSelect(next)
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-rule-strong bg-ground">
            {COLUMNS.map((column, index) => {
              const active = column.key && sort === column.key
              return (
                <th
                  key={column.label || `col-${index}`}
                  scope="col"
                  aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
                  className={`label px-2 py-1.5 font-semibold ${column.className}`}
                >
                  {index === 0 ? (
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      disabled={rows.length === 0}
                      onChange={(checked) =>
                        onSelect(checked ? new Set(rows.map((row) => row.id)) : new Set())
                      }
                      label={allSelected ? 'Clear selection' : 'Select every lead on this page'}
                    />
                  ) : column.key ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key!)}
                      className={`label inline-flex items-center gap-1 transition-colors ${
                        active ? 'text-signal' : 'text-ink-faint hover:text-ink-dim'
                      }`}
                    >
                      {column.label}
                      {active ? (
                        <IconChevronDown className={`size-3 ${desc ? '' : 'rotate-180'}`} />
                      ) : null}
                    </button>
                  ) : (
                    <span className="text-ink-faint">{column.label}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody className="divide-y divide-rule">
          {rows.map((lead, index) => {
            const ticked = selected.has(lead.id)
            const due = lead.followUpAt !== null && lead.followUpAt <= now
            const deleted = lead.deletedAt !== null

            return (
              <tr
                key={lead.id}
                /*
                 * The keyboard cursor is this row's own DOM focus, so j and k
                 * move the browser's idea of "here" rather than painting a
                 * second one beside it. `tabIndex={-1}` makes the row a focus
                 * target without adding a hundred stops to the tab order.
                 */
                tabIndex={-1}
                {...{ [ROW_ATTRIBUTE]: index }}
                onFocus={() => onCursor?.(index)}
                className={`group transition-colors focus:bg-raise ${
                  deleted ? 'text-ink-faint' : 'text-ink-dim'
                } ${ticked ? 'bg-raise' : ''} hover:bg-raise`}
              >
                <td
                  className={`py-1.5 pl-3 ${
                    // The amber rule marks this as the book, the same way the
                    // feed uses it to mark rows that are already in it. A row
                    // in the bin loses it: it is not currently a record.
                    deleted ? 'border-l border-transparent' : 'border-l border-signal'
                  }`}
                >
                  <Checkbox
                    checked={ticked}
                    onChange={(checked) => toggleRow(lead.id, checked)}
                    label={`Select ${lead.name}`}
                  />
                </td>

                <td className="px-2 py-1.5 text-right font-data text-sm">
                  {lead.score === null ? (
                    // Not a zero. Nothing has scored this lead yet, and saying
                    // 0 would rank it as the worst business in the book.
                    <span className="text-ink-faint" title="Not scored yet">
                      —
                    </span>
                  ) : (
                    <span className="text-ink">{lead.score}</span>
                  )}
                </td>

                <td className="px-2 py-1.5">
                  <div className="flex items-baseline gap-2">
                    {/*
                      The way into the diagnosis. A name is what the operator
                      already looks at to identify a row, so it is what he
                      should be able to click — no separate affordance to find,
                      and no widening of the row to hold one.
                    */}
                    <Link
                      href={`/leads/${lead.id}`}
                      className={`truncate underline decoration-transparent underline-offset-2 transition-colors hover:decoration-ink-faint ${
                        deleted ? 'text-ink-faint line-through' : 'text-ink'
                      }`}
                      title={lead.name}
                    >
                      {lead.name}
                    </Link>
                    {lead.lists.map((list) => (
                      <span
                        key={list.id}
                        className="label shrink-0 text-ink-faint"
                        title={`In list ${list.name}`}
                      >
                        {list.name}
                      </span>
                    ))}
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
                  <span className={`label ${STATUS_TONE[lead.status] ?? 'text-ink-dim'}`}>
                    {lead.status}
                  </span>
                </td>

                <td className="px-2 py-1.5">
                  {lead.website ? (
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={lead.website}
                      className="block truncate font-data text-sm text-ink-faint underline decoration-rule-strong underline-offset-2 transition-colors hover:text-ink-dim hover:decoration-ink-faint"
                    >
                      {hostname(lead.website)}
                    </a>
                  ) : (
                    <span className="label text-ink">No site</span>
                  )}
                </td>

                <td className="px-2 py-1.5">
                  <AuditMarks lead={lead} />
                </td>

                <td className="hidden truncate px-2 py-1.5 text-sm lg:table-cell">
                  {lead.city ?? <span className="text-ink-faint">—</span>}
                </td>

                <td className="hidden truncate px-2 py-1.5 text-sm 2xl:table-cell">
                  {lead.primaryType ? formatPlaceType(lead.primaryType) : '—'}
                </td>

                <td className="hidden px-2 py-1.5 font-data text-micro xl:table-cell">
                  {lead.followUpAt ? (
                    // Due or overdue gets `signal`: it is the operator's own
                    // decision coming back at him, not a failure of anything.
                    <span className={due ? 'text-signal' : 'text-ink-faint'}>
                      {shortDate(lead.followUpAt)}
                    </span>
                  ) : (
                    <span className="text-ink-ghost">—</span>
                  )}
                </td>

                <td className="hidden px-2 py-1.5 font-data text-micro text-ink-faint md:table-cell">
                  {shortDate(lead.savedAt)}
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
          })}
        </tbody>
      </table>
    </div>
  )
}
