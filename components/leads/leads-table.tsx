'use client'

import { IconChevronDown, IconExternal, IconPulse } from '@/components/icons'
import { Checkbox } from '@/components/ui/controls'
import { formatPlaceType } from '@/lib/places-types'
import {
  SLOW_LOAD_MS,
  STALE_COPYRIGHT_YEARS,
  type LeadRow,
  type LeadSort,
} from '@/lib/leads/types'

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

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(2)}`
}

/** `2026-08-14` from a date column, without a timezone shifting it a day. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * The audit, as marks.
 *
 * Only faults are drawn. A row of green ticks for everything a site got right
 * would fill the widest column on the surface with the one thing the operator
 * is never looking for, and the eye would have to subtract it every pass.
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

  const marks: React.ReactNode[] = []
  const staleBefore = new Date().getFullYear() - STALE_COPYRIGHT_YEARS

  if (lead.websiteStatus === 'no_website') {
    marks.push(
      <span key="none" className="label text-ink">
        No site
      </span>,
    )
  } else if (lead.websiteStatus === 'unreachable') {
    marks.push(
      <span key="dead" className="label text-ink">
        Unreachable
      </span>,
    )
  } else {
    if (lead.isHttps === false) {
      marks.push(
        <span key="https" className="label text-ink">
          No HTTPS
        </span>,
      )
    }
    if (lead.isMobileFriendly === false) {
      marks.push(
        <span key="mobile" className="label text-ink">
          Not mobile
        </span>,
      )
    }
    if (lead.hasMetaDescription === false) {
      marks.push(
        <span key="meta" className="label text-ink-dim">
          No meta
        </span>,
      )
    }
    if (lead.copyrightYear !== null && lead.copyrightYear < staleBefore) {
      marks.push(
        <span key="year" className="font-data text-micro text-ink" title="Footer copyright year">
          ©{lead.copyrightYear}
        </span>,
      )
    }
    if (lead.loadMs !== null && lead.loadMs > SLOW_LOAD_MS) {
      marks.push(
        <span key="slow" className="font-data text-micro text-ink-dim" title="Page load time">
          {(lead.loadMs / 1000).toFixed(1)}s
        </span>,
      )
    }
  }

  if (!marks.length) {
    return (
      <span className="label text-ink-faint" title={`Audited ${shortDate(lead.lastAuditedAt)}`}>
        Nothing found
        {lead.platform ? ` · ${lead.platform}` : ''}
      </span>
    )
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" title={`Audited ${shortDate(lead.lastAuditedAt)}`}>
      {marks}
      {lead.platform ? (
        <span className="font-data text-micro text-ink-faint">{lead.platform}</span>
      ) : null}
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
}: {
  rows: LeadRow[]
  selected: Set<string>
  onSelect: (next: Set<string>) => void
  sort: LeadSort
  desc: boolean
  onSort: (key: LeadSort) => void
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
          {rows.map((lead) => {
            const ticked = selected.has(lead.id)
            const due = lead.followUpAt !== null && lead.followUpAt <= now
            const deleted = lead.deletedAt !== null

            return (
              <tr
                key={lead.id}
                className={`group transition-colors ${
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
                    <span
                      className={`truncate ${deleted ? 'text-ink-faint line-through' : 'text-ink'}`}
                      title={lead.name}
                    >
                      {lead.name}
                    </span>
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
