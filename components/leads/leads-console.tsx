'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { IconAlert, IconPulse, IconStrike, IconUndo } from '@/components/icons'
import { BulkBar } from '@/components/leads/bulk-bar'
import { EmptyLibrary, EmptyResult } from '@/components/leads/empty-library'
import { ExportCsv } from '@/components/leads/export-csv'
import { FilterBar } from '@/components/leads/filter-bar'
import { LeadsTable } from '@/components/leads/leads-table'
import { SavedViews } from '@/components/leads/saved-views'
import { StatusStrip } from '@/components/shell/status-strip'
import { CommandButton } from '@/components/ui/command-button'
import { useListKeys } from '@/components/ui/use-list-keys'
import { useRowSelection } from '@/components/ui/use-row-selection'
import { ago } from '@/lib/leads/dates'
import {
  activeFilterCount,
  filtersToHref,
  naturalDesc,
  sameFilters,
  toSearchParams,
} from '@/lib/leads/filters'
import type {
  BulkAction,
  BulkResult,
  LeadFacets,
  LeadFilters,
  LeadListing,
  LeadSort,
  SavedView,
} from '@/lib/leads/types'

/*
 * The library, assembled.
 *
 * Band order is the order the operator reads in: views (which question), filters
 * (narrow it), provenance (what this is and how old), selection actions (act),
 * then the rows. The selection bar sits above the table for the same reason the
 * save bar does on the feed — the eye is already there, and a hundred-row table
 * would otherwise put the controls off screen.
 *
 * Every filter change is a navigation. That is not incidental: it is what makes
 * the back button undo a filter, makes a narrowed library a bookmark, and lets
 * a saved view be nothing but a stored query string.
 */

/** How long a delete stays one click from undone. */
const UNDO_WINDOW_MS = 20_000

export function LeadsConsole({
  filters,
  listing,
  facets,
  views,
  lists,
  pendingAudits,
}: {
  filters: LeadFilters
  listing: LeadListing
  facets: LeadFacets
  views: SavedView[]
  lists: { id: string; name: string }[]
  pendingAudits: number
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ ids: string[]; count: number } | null>(null)
  /** True once "select all matching" has widened the selection past this page. */
  const [wholeFilter, setWholeFilter] = useState(false)
  /** Where the keyboard is in the table. -1 is nowhere, which is where it starts. */
  const [cursor, setCursor] = useState(-1)
  /** Owned here rather than in the views bar, because `s` is what opens it. */
  const [naming, setNaming] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const query = toSearchParams(filters).toString()

  /*
   * A new question means a new selection. Keeping ticks across a filter change
   * would let a bulk action hit rows that are no longer on screen.
   *
   * Adjusted during render rather than in an effect. React re-runs this
   * component immediately with the corrected state and never commits the stale
   * pass, so the table cannot paint one frame of the old selection against the
   * new rows — which an effect would allow.
   */
  const [lastQuery, setLastQuery] = useState(query)
  if (lastQuery !== query) {
    setLastQuery(query)
    setSelected(new Set())
    setWholeFilter(false)
    // The cursor is a position in a list of rows. A new question is a new list.
    setCursor(-1)
  }

  /*
   * Selection lives here rather than in the table, because the table is not the
   * only thing that touches it: the bulk bar clears it, a finished action
   * empties it, "select all matching" widens it and a filter change throws it
   * away. One owner, and the gestures in the rows are one more caller.
   */
  const ids = useMemo(() => listing.rows.map((row) => row.id), [listing.rows])
  const onSelect = useCallback((next: Set<string>) => {
    setSelected(next)
    // Touching a box is a statement about these rows, so it ends the "everything
    // matching the filters" claim rather than quietly keeping it — otherwise
    // un-ticking one row would still delete all four thousand.
    setWholeFilter(false)
  }, [])
  const selection = useRowSelection({ ids, selected, onSelect })

  const navigate = useCallback(
    (next: LeadFilters) => router.push(filtersToHref(next)),
    [router],
  )

  const onFilterChange = useCallback(
    (patch: Partial<LeadFilters>) => {
      // Any narrowing returns to page one: page 7 of a different question is
      // almost always empty, and an empty table reads as a broken filter.
      navigate({ ...filters, ...patch, page: 1 })
    },
    [filters, navigate],
  )

  const onSort = useCallback(
    (key: LeadSort) => {
      navigate({
        ...filters,
        sort: key,
        // Clicking the active column flips it; a new column starts in whichever
        // direction that column is actually useful in.
        desc: filters.sort === key ? !filters.desc : naturalDesc(key),
        page: 1,
      })
    },
    [filters, navigate],
  )

  async function act(action: BulkAction, ids?: string[]) {
    /*
     * Two shapes of selection, and the difference is deliberate.
     *
     * Explicit ids are what he ticked. `filters` means "everything matching
     * this view" — resolved on the server against the same query the page was
     * drawn from, because the whole point of that selection is the rows he has
     * never scrolled to and cannot send ids for.
     */
    const byFilter = wholeFilter && !ids
    const target = ids ?? [...selected]
    if (!byFilter && !target.length) return

    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/leads/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          byFilter ? { ...action, filters: query } : { ...action, ids: target },
        ),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error ?? 'The action failed.')

      const result = body as BulkResult
      setNotice(result.message)
      setSelected(new Set())
      setWholeFilter(false)

      // Only a delete offers an undo, and it offers exactly the rows it hid.
      if (action.action === 'delete' && result.undoIds?.length) {
        setUndo({ ids: result.undoIds, count: result.affected })
      } else {
        setUndo(null)
      }

      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action failed.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Widen the selection to every row matching the filters.
   *
   * No request: the set is described by the filters, and the action route
   * resolves it when something is actually done to it. Ticking the visible
   * boxes as well keeps the table honest about being included.
   */
  function selectFiltered() {
    setWholeFilter(true)
    setSelected(new Set(listing.rows.map((row) => row.id)))
  }

  // The undo band is a window, not a permanent fixture — but the delete stays
  // reversible from the bin long after it closes.
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [undo])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  /*
   * While audits are in flight, keep the queue moving and refresh the page when
   * the number moves. Polling rather than a socket because the whole thing
   * lasts seconds and there is exactly one client.
   *
   * POST, not GET, and that is load-bearing rather than pedantry: a pass is
   * bounded by how long a serverless function may live, so the work is done in
   * slices and something has to ask for the next one. This poll is that
   * something — it drains the queue as well as reading it, which is how a large
   * save finishes auditing at all, and how the slow PageSpeed stage advances
   * behind the fast checks.
   */
  const lastPending = useRef(pendingAudits)
  useEffect(() => {
    if (pendingAudits <= 0) return
    lastPending.current = pendingAudits

    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/audits', { method: 'POST' })
        const body = (await response.json()) as { pending?: number }
        if (typeof body.pending !== 'number') return
        if (body.pending !== lastPending.current) {
          lastPending.current = body.pending
          router.refresh()
        }
      } catch {
        // A failed poll is not worth telling him about; the next one will do.
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [pendingAudits, router])

  /*
   * The keyboard for this surface.
   *
   * `s` saves what a library surface has to save — the question itself, as a
   * view. There is no other save here: a lead is saved on the feed and worked
   * on its own page, and binding `s` to a bulk status change would be a
   * destructive action one keystroke away from a movement key.
   */
  const canSaveView =
    activeFilterCount(filters) > 0 && !views.some((view) => sameFilters(view.filters, filters))

  useListKeys({
    count: listing.rows.length,
    cursor,
    onCursor: setCursor,
    onOpen: (index) => router.push(`/leads/${listing.rows[index].id}`),
    onSave: () => {
      if (canSaveView) setNaming(true)
    },
    onSearch: () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    },
    onToggle: selection.toggleAt,
    onExtend: selection.extendTo,
    onSelectAll: () => {
      // One key, both directions — `a` on a full page is how you empty it.
      if (wholeFilter || selected.size >= listing.rows.length) {
        setWholeFilter(false)
        selection.setAll(false)
      } else {
        selection.setAll(true)
      }
    },
    onEscape: () => {
      // The most recent thing first: a widened selection, then the ticks, then
      // the cursor. Escape should undo one decision, not the whole session.
      if (naming) setNaming(false)
      else if (wholeFilter || selected.size) selection.clear()
      else setCursor(-1)
    },
  })

  const oldest = useMemo(() => {
    if (!listing.rows.length) return null
    return listing.rows.reduce(
      (acc, row) => (row.fetchedAt < acc ? row.fetchedAt : acc),
      listing.rows[0].fetchedAt,
    )
  }, [listing.rows])

  const from = (listing.page - 1) * listing.pageSize + 1
  const to = Math.min(listing.page * listing.pageSize, listing.total)
  const pages = Math.max(1, Math.ceil(listing.total / listing.pageSize))

  const detail =
    listing.total === 0
      ? `0 of ${listing.libraryTotal.toLocaleString('de-DE')} records`
      : `${from.toLocaleString('de-DE')}–${to.toLocaleString('de-DE')} of ${listing.total.toLocaleString('de-DE')}`

  return (
    <>
      <SavedViews
        views={views}
        filters={filters}
        onApply={(next) => navigate({ ...next, page: 1 })}
        onChanged={() => router.refresh()}
        naming={naming}
        onNaming={setNaming}
      />

      <FilterBar
        filters={filters}
        facets={facets}
        onChange={onFilterChange}
        inputRef={searchRef}
      />

      <StatusStrip provenance="book" detail={detail}>
        {pendingAudits > 0 ? (
          <span className="label flex items-center gap-1.5 text-ink-faint">
            <IconPulse className="size-3.5 animate-pulse" />
            Auditing {pendingAudits}
          </span>
        ) : null}

        <span className="hidden font-data text-micro text-ink-faint lg:inline">
          j/k move · x tick · ⇧j/k run · a all
        </span>

        <span className="hidden font-data text-micro text-ink-faint xl:inline">
          ⏎ open · s save view · / search
        </span>

        {/* Principle 5: the Google-sourced columns on these rows state their age. */}
        {oldest ? (
          <span
            className="hidden font-data text-micro text-ink-faint lg:inline"
            title="Age of the oldest Google snapshot on this page"
          >
            snapshot {ago(oldest)}
          </span>
        ) : null}

        {/*
          The export takes the query string this page was drawn from, so the
          file is this view and cannot be anything else.
        */}
        <ExportCsv query={query} count={listing.total} />

        <button
          type="button"
          onClick={() => navigate({ ...filters, deleted: !filters.deleted, page: 1 })}
          className={`label flex items-center gap-1.5 transition-colors ${
            filters.deleted ? 'text-signal' : 'text-ink-faint hover:text-ink-dim'
          }`}
        >
          <IconStrike className="size-3.5" />
          {filters.deleted
            ? 'Back to the book'
            : `Deleted${facets.deletedCount ? ` · ${facets.deletedCount}` : ''}`}
        </button>
      </StatusStrip>

      {undo ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule border-l border-l-signal bg-panel px-3 py-2">
          <span className="text-sm text-ink-dim">
            <strong className="font-semibold text-ink">{undo.count}</strong>{' '}
            {undo.count === 1 ? 'lead' : 'leads'} deleted. Nothing is gone — they keep
            their notes and history, and wait thirty days in Deleted.
          </span>
          <CommandButton
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => {
              const ids = undo.ids
              setUndo(null)
              void act({ action: 'restore' }, ids)
            }}
            className="ml-auto"
          >
            <IconUndo className="size-3.5" />
            Undo
          </CommandButton>
        </div>
      ) : null}

      {/*
        A receipt for something that has already happened, so it is polite: it
        waits for a gap rather than interrupting. The band appears and vanishes
        on a timer, and the operator's eye is on the table when it does.
      */}
      {notice && !undo ? (
        <div role="status" className="border-b border-rule bg-panel px-3 py-1.5">
          <span className="text-sm text-ink-dim">{notice}</span>
        </div>
      ) : null}

      {/*
        `alert`, not `status`: an action he asked for did not happen, and unlike
        the notice above this one does not clear itself.
      */}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-rule border-l border-l-alert bg-panel px-3 py-2"
        >
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <p className="text-sm wrap-anywhere text-ink-dim">{error}</p>
        </div>
      ) : null}

      <BulkBar
        // Once widened, the count is the filter's total, not the page's ticks —
        // that is the number the next action will actually touch.
        count={wholeFilter ? listing.total : selected.size}
        wholeFilter={wholeFilter}
        totalMatching={listing.total}
        lists={lists}
        deletedView={filters.deleted}
        busy={busy}
        onClear={selection.clear}
        onSelectFiltered={selectFiltered}
        onAction={(action) => void act(action)}
      />

      {listing.rows.length === 0 ? (
        listing.libraryTotal === 0 && !filters.deleted ? (
          <EmptyLibrary />
        ) : (
          <EmptyResult
            libraryTotal={listing.libraryTotal}
            deletedView={filters.deleted}
            onClear={() =>
              navigate({
                ...filters,
                q: '',
                status: [],
                listIds: [],
                cities: [],
                categories: [],
                scoreMin: null,
                scoreMax: null,
                audit: [],
                change: [],
                followUp: null,
                page: 1,
              })
            }
          />
        )
      ) : (
        <>
          <LeadsTable
            rows={listing.rows}
            selected={selected}
            selection={selection}
            sort={filters.sort}
            desc={filters.desc}
            onSort={onSort}
            cursor={cursor}
            onCursor={setCursor}
          />

          {pages > 1 ? (
            <div className="flex items-center gap-3 border-t border-rule bg-panel px-3 py-2">
              <span className="font-data text-micro text-ink-faint">
                Page {listing.page} of {pages}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <CommandButton
                  type="button"
                  disabled={listing.page <= 1}
                  onClick={() => navigate({ ...filters, page: listing.page - 1 })}
                >
                  Previous
                </CommandButton>
                <CommandButton
                  type="button"
                  disabled={listing.page >= pages}
                  onClick={() => navigate({ ...filters, page: listing.page + 1 })}
                >
                  Next
                </CommandButton>
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
