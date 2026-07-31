'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { IconAlert, IconClose, IconSearch } from '@/components/icons'
import { StatusStrip } from '@/components/shell/status-strip'
import { CommandButton, CommandLink } from '@/components/ui/command-button'
import { INPUT, Menu, MenuItem, MenuLabel } from '@/components/ui/controls'
import { EmptyState } from '@/components/ui/states'
import { cursorProps, useListKeys } from '@/components/ui/use-list-keys'
import { FOLLOW_UP_PRESETS, datePlus, dueLabel, shortDate } from '@/lib/leads/dates'
import { coldFilters, dueFilters, filtersToHref } from '@/lib/leads/filters'
import { patchLead, type LeadPatch } from '@/lib/leads/patch'
import {
  COLD_SCORE_FLOOR,
  LEAD_STATUSES,
  type LeadRow,
  type LeadStatus,
  type OutreachQueues,
} from '@/lib/leads/types'

/*
 * The queue: who is due, and who is worth calling unprompted.
 *
 * Not a third store of leads — two questions asked of the book, which is why
 * each queue can hand him the same rows in the library with one click and why a
 * lead leaves a queue by being worked rather than by being dismissed. Nothing
 * here is dequeued, checked off or archived; he sets a status or a date, and the
 * next read simply does not find it.
 *
 * The order is the working order. Due comes first, most overdue at the top,
 * because that is the debt. Cold sits underneath it, best score first, because
 * it is what he does once the debt is paid.
 *
 * Every row can be worked without opening it — status, a date, a note — and the
 * three commit together as one entry in that lead's history, exactly as they do
 * on the lead's own page. The controls appear on the row the cursor is on rather
 * than on all of them: a hundred rows each carrying six controls is not a queue,
 * it is a form.
 */

/** Nothing is a card. The cursor row is marked with the system's focus rule. */
const CURSOR_RING = '[outline:1px_solid_var(--color-signal)] [outline-offset:-1px]'

interface Staged {
  id: string
  status?: LeadStatus
  followUpAt?: string | null
  note: string
}

function isDirty(edit: Staged | null): boolean {
  if (!edit) return false
  return edit.status !== undefined || edit.followUpAt !== undefined || edit.note.trim() !== ''
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function OutreachConsole({ due, cold }: OutreachQueues) {
  const router = useRouter()

  const [needle, setNeedle] = useState('')
  const [cursor, setCursor] = useState(-1)
  const [edit, setEdit] = useState<Staged | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const queues = useMemo(
    () => [
      {
        key: 'due',
        title: 'Due',
        note: 'Follow-ups that have arrived. Oldest debt first.',
        listing: due,
        href: filtersToHref(dueFilters()),
      },
      {
        key: 'cold',
        title: 'Cold',
        note: `Scored ${COLD_SCORE_FLOOR} or better, still new, never scheduled.`,
        listing: cold,
        href: filtersToHref(coldFilters()),
      },
    ],
    [due, cold],
  )

  // One index space across both queues, so j runs off the bottom of Due and into
  // the top of Cold rather than stopping at a heading.
  const { sections, flat } = useMemo(() => {
    const query = needle.trim().toLowerCase()
    const ordered: LeadRow[] = []
    const sections = queues.map((queue) => {
      const matching = query
        ? queue.listing.rows.filter((row) => row.name.toLowerCase().includes(query))
        : queue.listing.rows
      const offset = ordered.length
      ordered.push(...matching)
      return { ...queue, rows: matching, offset }
    })
    return { sections, flat: ordered }
  }, [queues, needle])

  function stage(id: string, patch: Partial<Omit<Staged, 'id'>>) {
    setEdit((previous) => {
      const base: Staged = previous?.id === id ? previous : { id, note: '' }
      return { ...base, ...patch }
    })
  }

  async function commit() {
    if (!edit || !isDirty(edit) || busy) return

    const lead = flat.find((row) => row.id === edit.id)
    const patch: LeadPatch = {}
    if (edit.status !== undefined) patch.status = edit.status
    if (edit.followUpAt !== undefined) patch.followUpAt = edit.followUpAt
    if (edit.note.trim()) patch.note = edit.note.trim()

    setBusy(true)
    setError(null)
    try {
      await patchLead(edit.id, patch)
      const said = [
        patch.status,
        patch.followUpAt === undefined
          ? null
          : patch.followUpAt === null
            ? 'follow-up cleared'
            : `follow up ${shortDate(patch.followUpAt)}`,
        patch.note ? 'note saved' : null,
      ].filter(Boolean)
      setNotice(`${lead?.name ?? 'Lead'} — ${said.join(', ')}.`)
      setEdit(null)
      // The row leaves the queue here if the change took it out of one, and the
      // counts in the strip are re-read by the same refresh.
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  useListKeys({
    count: flat.length,
    cursor,
    onCursor: setCursor,
    onOpen: (index) => router.push(`/leads/${flat[index].id}`),
    onSave: () => void commit(),
    onSearch: () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    },
    onEscape: () => {
      // Staged work first, cursor second: escape undoes the most recent thing.
      if (isDirty(edit)) setEdit(null)
      else setCursor(-1)
    },
  })

  // A notice is a receipt, not a state. It goes on its own, like the book's.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const detail = `${due.total.toLocaleString('de-DE')} due · ${cold.total.toLocaleString('de-DE')} cold`

  if (due.total + cold.total === 0) {
    return (
      <>
        <StatusStrip provenance="book" detail={detail} />
        <EmptyState
          headline={due.libraryTotal ? 'Nothing to work' : 'Nothing queued'}
          body={
            due.libraryTotal
              ? `No follow-up has come due, and nothing in the book is scoring ${COLD_SCORE_FLOOR} or better while still untouched. Put a date on a lead and it appears here on the day.`
              : 'Leads show up here when a follow-up you set has arrived, or when they score well and you have never worked them. Save a lead first.'
          }
          action={
            <CommandLink href="/leads" variant="primary">
              Go to the book
            </CommandLink>
          }
        />
      </>
    )
  }

  return (
    <>
      <StatusStrip provenance="book" detail={detail}>
        <span className="hidden font-data text-micro text-ink-faint xl:inline">
          j/k move · ⏎ open · s save · / filter
        </span>
      </StatusStrip>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-2 py-2 md:px-3">
        <div className="relative min-w-[10rem] flex-1 md:max-w-xs">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Filter the queue"
            aria-label="Filter the queue by business name"
            className={`${INPUT} pl-8`}
          />
        </div>
        {needle ? (
          <CommandButton type="button" variant="quiet" onClick={() => setNeedle('')}>
            <IconClose className="size-3" />
            Clear
          </CommandButton>
        ) : null}
      </div>

      {notice ? (
        <div className="border-b border-rule bg-panel px-3 py-1.5">
          <span className="text-sm text-ink-dim">{notice}</span>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 border-b border-rule border-l border-l-alert bg-panel px-3 py-2">
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <p className="text-sm text-ink-dim">{error}</p>
        </div>
      ) : null}

      <div className="flex-1">
        {sections.map((section) => (
          <section key={section.key}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule bg-panel px-3 py-1.5">
              <h2 className="label text-ink">
                {section.title} — {section.listing.total.toLocaleString('de-DE')}
              </h2>
              <p className="text-sm text-ink-faint">{section.note}</p>
              <Link
                href={section.href}
                className="label ml-auto text-ink-faint transition-colors hover:text-signal"
              >
                Open in the book
              </Link>
            </div>

            {section.rows.length === 0 ? (
              <p className="border-b border-rule px-3 py-3 text-sm text-ink-faint">
                {section.listing.total === 0
                  ? section.key === 'due'
                    ? 'Nothing is due. A date you put on a lead lands here on the day it arrives.'
                    : `Nothing untouched is scoring ${COLD_SCORE_FLOOR} or better.`
                  : 'No name in this queue matches the filter.'}
              </p>
            ) : (
              <ul>
                {section.rows.map((lead, index) => (
                  <QueueRow
                    key={lead.id}
                    lead={lead}
                    queue={section.key}
                    active={cursor === section.offset + index || edit?.id === lead.id}
                    cursored={cursor === section.offset + index}
                    edit={edit?.id === lead.id ? edit : null}
                    busy={busy}
                    onFocus={() => setCursor(section.offset + index)}
                    onStage={(patch) => stage(lead.id, patch)}
                    onSave={() => void commit()}
                    onDiscard={() => setEdit(null)}
                  />
                ))}
              </ul>
            )}

            {/*
              A queue is capped at one page. Saying so is the difference between
              a short list and a short list that is hiding four hundred rows.
            */}
            {section.listing.total > section.listing.rows.length ? (
              <p className="border-b border-rule px-3 py-1.5 font-data text-micro text-ink-faint">
                Showing the first {section.listing.rows.length} of{' '}
                {section.listing.total.toLocaleString('de-DE')} — the rest are in the book.
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * One row, and what can be done to it without leaving the queue
 * ------------------------------------------------------------------------- */

function QueueRow({
  lead,
  queue,
  active,
  cursored,
  edit,
  busy,
  onFocus,
  onStage,
  onSave,
  onDiscard,
}: {
  lead: LeadRow
  queue: string
  /** Showing its controls: the cursor is here, or something is staged on it. */
  active: boolean
  cursored: boolean
  edit: Staged | null
  busy: boolean
  onFocus: () => void
  onStage: (patch: Partial<Omit<Staged, 'id'>>) => void
  onSave: () => void
  onDiscard: () => void
}) {
  const status = edit?.status ?? lead.status
  const shownDate = edit?.followUpAt === undefined ? lead.followUpAt : edit.followUpAt
  const dirty = isDirty(edit)

  return (
    <li
      {...cursorProps(cursored)}
      // Clicking anywhere in a row also moves the cursor, so the mouse and the
      // keyboard share one notion of "this one".
      onPointerDown={onFocus}
      className={`border-b border-rule border-l border-l-signal transition-colors ${
        active ? 'bg-raise' : 'hover:bg-raise'
      } ${cursored ? CURSOR_RING : ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-1.5">
        <span
          className="w-8 shrink-0 text-right font-data text-sm text-ink"
          title={lead.score === null ? 'Not scored yet' : `Score ${lead.score}`}
        >
          {lead.score ?? <span className="text-ink-faint">—</span>}
        </span>

        <Link
          href={`/leads/${lead.id}`}
          title={lead.name}
          className="max-w-[22rem] truncate text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-ink-faint"
        >
          {lead.name}
        </Link>

        <span className={`label ${edit?.status ? 'text-signal' : 'text-ink-dim'}`}>{status}</span>

        {lead.website ? (
          <a
            href={lead.website}
            target="_blank"
            rel="noopener noreferrer"
            title={lead.website}
            className="hidden max-w-[14rem] truncate font-data text-micro text-ink-faint underline decoration-rule-strong underline-offset-2 transition-colors hover:text-ink-dim md:inline"
          >
            {hostname(lead.website)}
          </a>
        ) : (
          // The reason to call, at full ink — the same reading the feed gives it.
          <span className="label text-ink">No site</span>
        )}

        {lead.city ? (
          <span className="hidden font-data text-micro text-ink-faint lg:inline">{lead.city}</span>
        ) : null}

        {lead.phone ? (
          <a
            href={`tel:${lead.phone}`}
            className="hidden font-data text-micro text-ink-dim transition-colors hover:text-signal xl:inline"
          >
            {lead.phone}
          </a>
        ) : null}

        <span className="ml-auto shrink-0 font-data text-micro">
          {shownDate ? (
            <span className={edit?.followUpAt !== undefined ? 'text-signal' : 'text-ink-faint'}>
              {shortDate(shownDate)} · {dueLabel(shownDate)}
            </span>
          ) : queue === 'cold' ? (
            <span className="text-ink-faint">never scheduled</span>
          ) : (
            <span className="text-ink-ghost">—</span>
          )}
        </span>
      </div>

      {active ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-rule px-3 py-1.5">
          <Menu
            label={<span className={edit?.status ? 'text-signal' : ''}>Status</span>}
            width="w-44"
            disabled={busy}
          >
            {(close) => (
              <>
                <MenuLabel>Set status to</MenuLabel>
                {LEAD_STATUSES.map((entry) => (
                  <MenuItem
                    key={entry}
                    onClick={() => {
                      onStage({ status: entry === lead.status ? undefined : entry })
                      close()
                    }}
                  >
                    <span className={entry === status ? 'text-ink' : ''}>{entry}</span>
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>

          {FOLLOW_UP_PRESETS.map((preset) => (
            <CommandButton
              key={preset.key}
              type="button"
              disabled={busy}
              onClick={() => onStage({ followUpAt: datePlus(preset.step) })}
            >
              {preset.label}
            </CommandButton>
          ))}

          {shownDate ? (
            <CommandButton
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => onStage({ followUpAt: null })}
            >
              <IconClose className="size-3" />
              Clear date
            </CommandButton>
          ) : null}

          {/* INPUT is w-full; the box around a field owns its width. */}
          <span className="min-w-[12rem] flex-1">
            <input
              type="text"
              value={edit?.note ?? ''}
              disabled={busy}
              placeholder="Note — saved with the above, as one entry"
              aria-label={`Note on ${lead.name}`}
              onChange={(event) => onStage({ note: event.target.value })}
              onKeyDown={(event) => {
                // Enter commits from inside the field, where `s` is a letter.
                if (event.key !== 'Enter') return
                event.preventDefault()
                onSave()
              }}
              className={`${INPUT} font-ui`}
            />
          </span>

          <CommandButton
            type="button"
            variant="primary"
            keyHint="S"
            disabled={!dirty || busy}
            onClick={onSave}
          >
            {busy ? 'Saving' : 'Save'}
          </CommandButton>

          {dirty ? (
            <CommandButton type="button" variant="quiet" disabled={busy} onClick={onDiscard}>
              Discard
            </CommandButton>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
