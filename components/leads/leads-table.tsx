'use client'

import Link from 'next/link'

import { IconChevronDown, IconExternal, IconPulse } from '@/components/icons'
import { ChangeMarks } from '@/components/leads/change-marks'
import { SEVERITY_TONE } from '@/components/leads/tone'
import { Checkbox, SelectionCell } from '@/components/ui/controls'
import { cursorProps } from '@/components/ui/use-list-keys'
import type { RowSelection } from '@/components/ui/use-row-selection'
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

/**
 * Status brightness.
 *
 * Not colour: DESIGN.md allows exactly three signal colours and each already
 * means one thing. So a status says how much of the operator's attention it
 * wants through contrast alone — untouched at full ink, in-flight at dim,
 * closed faded back.
 */
const STATUS_TONE: Record<string, string> = {
  new: 'text-ink',
  researching: 'text-ink-dim',
  contacted: 'text-ink-dim',
  replied: 'text-ink-dim',
  proposal: 'text-ink-dim',
  won: 'text-ink-faint',
  lost: 'text-ink-faint',
  parked: 'text-ink-faint',
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/*
 * The cursor row, marked with the system's own focus treatment rather than a
 * fill: selection and hover already spend `raise`, and a third tone of grey
 * would be one distinction too many to make at speed.
 */
const CURSOR_RING = '[outline:1px_solid_var(--color-signal)] [outline-offset:-1px]'

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
function AuditMarks({ lead }: { lead: LeadRow }) {
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
  selection,
  sort,
  desc,
  onSort,
  cursor,
  onCursor,
}: {
  rows: LeadRow[]
  selected: Set<string>
  /** Every way a row can be ticked. Owned by the console, with the keyboard. */
  selection: RowSelection
  sort: LeadSort
  desc: boolean
  onSort: (key: LeadSort) => void
  /** Row the keyboard is on. -1 when it is nowhere, which is where it starts. */
  cursor: number
  onCursor: (index: number) => void
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someSelected = !allSelected && rows.some((row) => selected.has(row.id))
  const now = today()

  return (
    <div className="flex-1 overflow-auto">
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
                  title={
                    index === 0
                      ? 'a — every lead on the page. Shift-click or drag a box below to take a run.'
                      : undefined
                  }
                  className={`label px-2 py-1.5 font-semibold ${column.className}`}
                >
                  {index === 0 ? (
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      disabled={rows.length === 0}
                      onChange={(checked) => selection.setAll(checked)}
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
            const cursored = index === cursor
            const due = lead.followUpAt !== null && lead.followUpAt <= now
            const deleted = lead.deletedAt !== null
            const category = lead.primaryType ? formatPlaceType(lead.primaryType) : null

            return (
              <tr
                key={lead.id}
                {...cursorProps(cursored)}
                // Clicking anywhere in a row is also how the cursor is moved,
                // so the mouse and the keyboard share one notion of "this one".
                onPointerDown={() => onCursor(index)}
                className={`group transition-colors ${
                  deleted ? 'text-ink-faint' : 'text-ink-dim'
                } ${ticked ? 'bg-raise' : ''} ${cursored ? `bg-raise ${CURSOR_RING}` : ''} hover:bg-raise`}
              >
                <SelectionCell
                  index={index}
                  selection={selection}
                  checked={ticked}
                  label={`Select ${lead.name}`}
                  className={
                    // The amber rule marks this as the book, the same way the
                    // feed uses it to mark rows that are already in it. A row
                    // in the bin loses it: it is not currently a record.
                    deleted ? 'border-l border-transparent' : 'border-l border-signal'
                  }
                />

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

                      The explicit max-width is what makes `truncate` work at
                      all. In an auto-layout table a cell grows to fit its
                      content, so overflow-hidden on something with no bound has
                      nothing to hide; only a definite width clips. German
                      business names are the case that proves it —
                      "Elektroinstallationen und Gebäudetechnik Müller GmbH &
                      Co. KG" is not an unusual one, and unclipped it pushes the
                      table past the viewport and drags every other column with
                      it. Widened at the breakpoints where there is room for it.
                    */}
                    <Link
                      href={`/leads/${lead.id}`}
                      className={`max-w-[14rem] min-w-0 truncate underline decoration-transparent underline-offset-2 transition-colors hover:decoration-ink-faint lg:max-w-[20rem] 2xl:max-w-[26rem] ${
                        deleted ? 'text-ink-faint line-through' : 'text-ink'
                      }`}
                      title={lead.name}
                    >
                      {lead.name}
                    </Link>

                    {/*
                      What has changed about the business, next to the business.
                      Never in the Audit column — a fault is something wrong
                      with a website, a change is something that happened to a
                      company, and the two must not be read as one list.
                    */}
                    <ChangeMarks codes={lead.changeFlags} at={lead.changedAt} />

                    {lead.lists.map((list) => (
                      <span
                        key={list.id}
                        className="label max-w-[8rem] shrink-0 truncate text-ink-faint"
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
                      className="block max-w-[10rem] truncate font-data text-sm text-ink-faint underline decoration-rule-strong underline-offset-2 transition-colors hover:text-ink-dim hover:decoration-ink-faint"
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

                {/*
                  The bound goes on the span, not the cell, for the reason it
                  does on the name above: a table cell in auto layout has no
                  width to overflow. Ortsteil-heavy German city strings and
                  Google's longer place types are both well past what these
                  columns can hold.
                */}
                <td className="hidden px-2 py-1.5 text-sm lg:table-cell">
                  {lead.city ? (
                    <span className="block max-w-[8rem] truncate" title={lead.city}>
                      {lead.city}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>

                <td className="hidden px-2 py-1.5 text-sm 2xl:table-cell">
                  <span className="block max-w-[9rem] truncate" title={category ?? undefined}>
                    {category ?? '—'}
                  </span>
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
