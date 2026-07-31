'use client'

import { useCallback, useMemo, useState } from 'react'

import { IconAlert, IconCeiling } from '@/components/icons'
import { CostReadout } from '@/components/search/cost-readout'
import {
  RANK_SORT,
  ResultsTable,
  nextSort,
  sortRows,
  type SortKey,
} from '@/components/search/results-table'
import { SaveBar } from '@/components/search/save-bar'
import { SearchForm } from '@/components/search/search-form'
import { useSearchStream } from '@/components/search/use-search-stream'
import { StatusStrip } from '@/components/shell/status-strip'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states'
import { useListKeys } from '@/components/ui/use-list-keys'
import { useRowSelection } from '@/components/ui/use-row-selection'
import type { BudgetState, SearchInput } from '@/lib/search/types'

/*
 * The Search surface, assembled.
 *
 * Band order is the order the operator reads in: what he asked (form), what it
 * costs (readout), what the data is and how old (status strip), then the rows.
 * The cost readout sits ABOVE the strip deliberately — on a $0 ceiling it is
 * the thing most likely to stop a session, so it must never be below the fold
 * of attention.
 */

function age(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function SearchConsole({ initialBudget }: { initialBudget: BudgetState }) {
  const { state, run, cancel, setBudget, markSaved } = useSearchStream(initialBudget)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState(RANK_SORT)
  /** Where the keyboard is in the table. -1 is nowhere, which is where it starts. */
  const [cursor, setCursor] = useState(-1)
  const running = state.status === 'running'

  /*
   * The sort lives here rather than in the table for the same reason the
   * selection does: a range is "the rows between these two AS DRAWN", so
   * whatever decides the drawing order has to be the thing the range and the
   * cursor are counted in.
   */
  const rows = useMemo(() => sortRows(state.rows, sort), [state.rows, sort])
  const ids = useMemo(() => rows.map((row) => row.providerPlaceId), [rows])
  const selection = useRowSelection({ ids, selected, onSelect: setSelected })

  // A page arriving mid-stream only ever appends, so a cursor stays where it
  // was. A new search does not, and the guard below is what catches that.
  const cursorIndex = cursor < rows.length ? cursor : -1

  const onSubmit = useCallback(
    (input: SearchInput) => {
      // A new search invalidates the old selection. Carrying ticks across two
      // result sets would let the operator save businesses he can no longer see.
      setSelected(new Set())
      setCursor(-1)
      void run(input)
    },
    [run],
  )

  useListKeys({
    count: rows.length,
    cursor: cursorIndex,
    onCursor: setCursor,
    onToggle: selection.toggleAt,
    onExtend: selection.extendTo,
    onSelectAll: () => selection.setAll(selected.size < rows.length),
    onEscape: () => {
      if (selected.size) selection.clear()
      else setCursor(-1)
    },
  })

  const detail = (() => {
    if (state.rows.length === 0) return running ? 'Fetching…' : 'No fetch this session'
    const count = `${state.rows.length} result${state.rows.length === 1 ? '' : 's'}`
    // Principle 5: anything sourced from Google states its age, and a replayed
    // set states that it is a replay rather than implying it is current.
    if (state.cachedAt) return `${count} · cached ${age(state.cachedAt)}`
    return `${count} · fetched just now`
  })()

  return (
    <>
      <SearchForm onSubmit={onSubmit} onCancel={cancel} running={running} />

      {state.budget ? (
        <CostReadout
          budget={state.budget}
          searchCostUsd={state.searchCostUsd}
          requests={state.requests}
          estimateUsd={state.estimateUsd}
          onCeilingChange={setBudget}
        />
      ) : null}

      <StatusStrip provenance="live" detail={detail}>
        {state.rows.length > 0 ? (
          <span className="hidden font-data text-micro text-ink-faint lg:inline">
            j/k move · x tick · ⇧j/k run · a all
          </span>
        ) : null}

        {state.cachedAt ? (
          <span className="label text-ink-faint" title="Replayed from an earlier identical search — no API call, no cost">
            Replayed
          </span>
        ) : null}
        {state.resolvedAddress ? (
          <span className="hidden font-data text-micro text-ink-faint lg:inline">
            {state.resolvedAddress}
          </span>
        ) : null}
      </StatusStrip>

      {/*
        The ceiling stopping a search is not an error — it is the instrument
        working, so it gets `signal` (the operator's own decision) rather than
        `alert` (something broke). Rows already fetched stay on screen below it.
      */}
      {state.blocked ? (
        <div className="flex items-start gap-2 border-b border-rule border-l-signal border-l bg-panel px-3 py-2">
          <IconCeiling className="mt-0.5 size-3.5 shrink-0 text-signal" />
          <div className="min-w-0">
            <p className="label text-signal">Monthly ceiling reached</p>
            <p className="mt-0.5 text-sm text-ink-dim">
              {state.blocked} Results fetched before the stop are shown below and are
              already paid for.
            </p>
          </div>
        </div>
      ) : null}

      {/*
        Between the strip and the rows: the selection is made below it and acted
        on here, so the bar sits where the eye already is rather than at the
        bottom of a sixty-row table.
      */}
      <SaveBar
        rows={state.rows}
        selected={selected}
        onSelect={setSelected}
        searchId={state.searchId}
        onSaved={markSaved}
      />

      {/*
        A failure PART WAY THROUGH is the ordinary shape of a Google outage: page
        one arrives, page two 500s. Those first twenty rows were billed, cached
        and are perfectly good — replacing the table with an error state would
        throw away work the operator has already paid for and tell him nothing
        was fetched, which is false.
      *
        So the error only takes the whole surface when there is nothing to lose.
        With rows on screen it is a band above them, in the same shape the
        ceiling notice uses, and the table stays exactly as it was.
      */}
      {state.status === 'error' && state.rows.length > 0 ? (
        <div className="flex items-start gap-2 border-b border-rule border-l border-l-alert bg-panel px-3 py-2">
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <div className="min-w-0">
            <p className="label text-alert">Google stopped answering part way</p>
            <p className="mt-0.5 text-sm text-ink-dim">
              {state.error} The {state.rows.length} result
              {state.rows.length === 1 ? '' : 's'} below arrived before it stopped, are
              already paid for, and can be saved. Search again for the rest.
            </p>
          </div>
        </div>
      ) : null}

      {state.status === 'error' && state.rows.length === 0 ? (
        <ErrorState
          headline="Search failed"
          body="Nothing was fetched and the run was recorded with its error. Check the query and the API key, then try again."
          detail={state.error ?? undefined}
        />
      ) : rows.length > 0 ? (
        <ResultsTable
          rows={rows}
          running={running}
          selected={selected}
          selection={selection}
          sort={sort}
          onSort={(key: SortKey) => setSort((prev) => nextSort(prev, key))}
          cursor={cursorIndex}
          onCursor={setCursor}
        />
      ) : running ? (
        <LoadingRows rows={14} label="Fetching results" />
      ) : (
        <EmptyState
          headline="No search run yet"
          body="Search an area and a category to pull businesses from Google Places. Results are transient — they expire on their own, and nothing is kept unless you save it."
        />
      )}
    </>
  )
}
