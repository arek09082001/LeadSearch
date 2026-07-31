'use client'

import { IconChevronDown } from '@/components/icons'
import {
  ResultsTable,
  nextSort,
  type SortKey,
  type SortState,
} from '@/components/search/results-table'
import type { RowSelection } from '@/components/ui/use-row-selection'
import type { SearchRow } from '@/lib/search/types'

/*
 * The same results, as rows.
 *
 * A field of marks answers "where are they"; it is a poor instrument for "take
 * these eleven". Ticking thirty businesses by clicking thirty dots is thirty
 * chances to miss, and the dots carry no name, no rating and no website column
 * to sort on — which is the whole basis for deciding which of them are worth
 * saving.
 *
 * So the feed gets its table back, under the map, sharing one selection with
 * it: a dot ticked on the field is a row ticked here, and a run taken here
 * lights up on the field. It is the search surface's own `ResultsTable`, not a
 * second one — same columns, same sort, same shift-click and drag gestures — so
 * there is one table in this product that shows Google's rows and it behaves
 * identically wherever it is drawn.
 *
 * It collapses to its own rule, because the map is still the reason to be here.
 */

export function ResultsDrawer({
  rows,
  selected,
  selection,
  sort,
  onSort,
  cursor,
  onCursor,
  running,
  cachedAt,
  open,
  onOpen,
}: {
  /** Already sorted, because the row order IS what a range is measured in. */
  rows: SearchRow[]
  selected: Set<string>
  selection: RowSelection
  sort: SortState
  onSort: (next: SortState) => void
  cursor: number
  onCursor: (index: number) => void
  running: boolean
  /** Set when this result set was replayed from an earlier search for nothing. */
  cachedAt: string | null
  open: boolean
  onOpen: (open: boolean) => void
}) {
  // No search, no drawer. A permanent empty table under the map would be a band
  // of chrome on the one surface whose point is the field beneath it.
  if (!rows.length && !running) return null

  return (
    <div
      className={`flex shrink-0 flex-col border-t border-rule bg-ground ${
        open ? 'h-[38%] min-h-[9rem]' : ''
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-rule bg-panel px-2 py-1.5 md:px-3">
        {/*
          The feed's provenance, stated where the feed's rows are. The strip at
          the top of this surface speaks for the book; this speaks for these.
        */}
        <span aria-hidden="true" className="size-1.5 shrink-0 bg-live" />
        <span className="label text-ink-dim">Live</span>

        <span aria-hidden="true" className="hidden h-3 w-px bg-rule-strong md:block" />

        <span className="hidden truncate text-sm text-ink-faint md:inline">
          Transient — from Google Places, expires automatically.
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {cachedAt ? (
            <span
              className="label text-ink-faint"
              title="Replayed from an earlier identical search — no API call, no cost"
            >
              Replayed
            </span>
          ) : null}

          {selected.size > 0 ? (
            <span className="label text-signal">{selected.size} selected</span>
          ) : null}

          <span className="font-data text-micro text-ink-faint">
            {running ? 'Fetching…' : `${rows.length} result${rows.length === 1 ? '' : 's'}`}
          </span>

          <button
            type="button"
            onClick={() => onOpen(!open)}
            aria-expanded={open}
            className="label flex items-center gap-1.5 text-ink-faint transition-colors hover:text-ink"
          >
            {open ? 'Hide' : 'Show'}
            <IconChevronDown
              className={`size-3 transition-transform ${open ? '' : 'rotate-180'}`}
            />
          </button>
        </div>
      </div>

      {open ? (
        // `min-h-0` is what lets the table scroll inside the drawer instead of
        // pushing it taller and squeezing the map out from under itself.
        <div className="flex min-h-0 flex-1 flex-col">
          <ResultsTable
            rows={rows}
            running={running}
            selected={selected}
            selection={selection}
            sort={sort}
            onSort={(key: SortKey) => onSort(nextSort(sort, key))}
            cursor={cursor}
            onCursor={onCursor}
          />
        </div>
      ) : null}
    </div>
  )
}
