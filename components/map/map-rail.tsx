'use client'

import Link from 'next/link'

import { IconChevronDown, IconSearch } from '@/components/icons'
import { Checkbox } from '@/components/ui/controls'
import { cursorProps } from '@/components/ui/use-list-keys'
import type { RowSelection } from '@/components/ui/use-row-selection'
import { distanceM, formatRadius, type Point } from '@/lib/map/geometry'
import { SORT_LABELS, nextSort, type SortKey, type SortState } from '@/lib/search/sort'
import type { SearchRow } from '@/lib/search/types'

/*
 * The map's one secondary column: what you selected, and what you found.
 *
 * IT IS BESIDE THE FIELD AND NOT UNDER IT, and that is the entire point of this
 * file. The feed used to open as a drawer along the bottom, which cost the map
 * 38% of its height at the exact moment the map became worth looking at — a
 * surface that shrinks the instrument as soon as it has something to show. On a
 * laptop, with the views bar, the filter bar, the strip, the receipt and the
 * save bar already stacked above, what was left of the field was a letterbox.
 *
 * Height is what a map is worth. Width it has to spare. So the rows go in a
 * column at the side, the field keeps every pixel of its height, and the rail
 * takes none at all when there is nothing to put in it.
 *
 * Below `lg` there is no width to spare either, so the same element becomes a
 * sheet resting on the bottom of the field — absolutely positioned, so it
 * covers the map instead of pushing it, and collapsible to its own header when
 * the operator wants the field back. It is the grammar the search panel and the
 * legend already use on this canvas: a ruled rectangle over `ground`, no
 * radius, no shadow.
 *
 * The rows themselves are deliberately NOT the search surface's table. Nine
 * columns do not go in 21rem, and a rail that scrolls sideways is a rail nobody
 * reads. What is here is what a decision on a map needs — is it worth calling,
 * where is it, is it already mine — and the full table is one link away on the
 * surface built for it, drawing the same rows, from the same store, for no
 * further money.
 */

/** The keyboard's row, marked the way the book and the table mark it. */
const CURSOR_RING = '[outline:1px_solid_var(--color-signal)] [outline-offset:-1px]'

/** `https://www.praxis-mueller.de/termine` -> `praxis-mueller.de`. */
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function ResultRow({
  row,
  index,
  ticked,
  cursored,
  reading,
  selection,
  center,
  onRead,
  onCursor,
}: {
  row: SearchRow
  index: number
  ticked: boolean
  cursored: boolean
  /** True when this is the row the panel above is showing. */
  reading: boolean
  selection: RowSelection
  /** The search centre, when there is one — a distance only means something from it. */
  center: Point | null
  onRead: (placeId: string) => void
  onCursor: (index: number) => void
}) {
  const saved = Boolean(row.savedLeadId)
  const at = row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null
  const away = center && at ? formatRadius(distanceM(center, at)) : null

  return (
    <li
      {...cursorProps(cursored)}
      // `tick` fires once on mount, so only genuinely new rows flash as a page
      // lands. Re-sorting reorders the same keys and stays still.
      className={`tick flex items-start border-b border-rule transition-colors ${
        // The saved rule, exactly as the table draws it: signal is the book,
        // everywhere in this product.
        saved ? 'border-l border-l-signal' : 'border-l border-l-transparent'
      } ${ticked || reading ? 'bg-raise' : ''} ${cursored ? `bg-raise ${CURSOR_RING}` : ''} hover:bg-raise`}
    >
      {/*
        The gesture handlers go on the box's own target, as they do in the
        table's selection cell — a shift-range and a paint drag are made in the
        checkbox column, and the rest of the row is for reading.
      */}
      <span className="shrink-0" {...selection.cellProps(index)}>
        <label className="flex cursor-pointer items-center py-2 pr-1.5 pl-2 select-none">
          <Checkbox
            checked={ticked}
            onChange={() => selection.pick(index)}
            label={`Select ${row.name ?? 'this business'}`}
          />
        </label>
      </span>

      {/*
        Reading a row is not deciding about it: this opens the panel and moves
        the field to the mark, and leaves the tick alone. `x` and the box are
        what tick.
      */}
      <button
        type="button"
        onClick={() => {
          onCursor(index)
          onRead(row.providerPlaceId)
        }}
        className="min-w-0 flex-1 py-1.5 pr-2 text-left"
      >
        <span className="flex items-baseline gap-1.5">
          <span className="w-4 shrink-0 text-right font-data text-micro text-ink-faint">
            {index + 1}
          </span>
          <span className={`min-w-0 flex-1 truncate text-sm ${saved ? 'text-ink-faint' : 'text-ink'}`}>
            {row.name ?? '—'}
          </span>
          {/*
            The whole reason this surface exists, carried by brightness rather
            than by a fourth colour — `No site` at full ink, a domain faded
            back. Same encoding as the table, in a narrower space.
          */}
          {row.website ? (
            <span className="max-w-[6.5rem] shrink truncate font-data text-micro text-ink-faint">
              {hostname(row.website)}
            </span>
          ) : (
            <span className={`label shrink-0 ${saved ? 'text-ink-dim' : 'text-ink'}`}>No site</span>
          )}
        </span>

        <span className="mt-0.5 flex items-baseline gap-1.5 pl-[1.375rem] font-data text-micro text-ink-faint">
          <span>{row.rating === null ? '—' : row.rating.toFixed(1)}</span>
          <span>·</span>
          <span>{(row.userRatingCount ?? 0).toLocaleString('de-DE')}</span>
          {away ? (
            <>
              <span>·</span>
              <span>{away}</span>
            </>
          ) : null}
          {/* Google withholds a coordinate now and then, and a row the field
              cannot take you to should say so rather than click into nothing. */}
          {at ? null : (
            <>
              <span>·</span>
              <span>off the map</span>
            </>
          )}
          {saved ? (
            <span className="label ml-auto shrink-0 text-signal">
              In book{row.savedStatus ? ` · ${row.savedStatus}` : ''}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

export function MapRail({
  rows,
  selected,
  selection,
  sort,
  onSort,
  cursor,
  onCursor,
  running,
  cachedAt,
  center,
  focusedResultId,
  onRead,
  open,
  onOpen,
  panel,
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
  center: Point | null
  focusedResultId: string | null
  onRead: (placeId: string) => void
  open: boolean
  onOpen: (open: boolean) => void
  /** The detail panel's content, when a mark is being read. */
  panel: React.ReactNode
}) {
  const feed = rows.length > 0 || running
  /** Rows actually taking height. Collapsed, the feed is one bar and no more. */
  const list = feed && open

  // Nothing selected and nothing found: the field gets the whole surface. A
  // permanent empty rail beside the map would be a band of chrome on the one
  // page whose point is what is underneath it.
  if (!feed && !panel) return null

  const plotted = rows.filter((row) => row.lat !== null && row.lng !== null).length

  return (
    <aside
      aria-label="The mark you selected, and the results"
      /*
        Two layouts, one element. Below `lg` it rests on the field as a sheet:
        `absolute`, so the map keeps its full height underneath rather than
        being pushed up by a list that just appeared. From `lg` it is an
        ordinary flex child — a ruled column beside the field, like every other
        secondary reading surface here.
      */
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col border-t border-rule bg-ground/95 lg:static lg:max-h-none lg:w-[21rem] lg:shrink-0 lg:border-t-0 lg:border-l lg:bg-ground"
    >
      {panel ? (
        <div
          /*
            With rows below it the panel is capped at half the rail, so the two
            things the operator is comparing — this one, and the list he picked
            it from — are both on screen. Alone, it takes the whole column.

            It is allowed to shrink past that cap (no `shrink-0`) with a floor
            under it, so a short sheet on a phone divides into two usable halves
            instead of one panel and a sliver. With the list collapsed there is
            nothing to divide with, and it takes the column back — but only from
            `lg`, where the rail has a height to fill. Below that the rail is a
            sheet sized by what is in it, and `flex-1` against a height nobody
            has stated resolves to nothing at all.
          */
          className={`overflow-y-auto ${list ? 'max-h-[55%] min-h-[7rem] border-b border-rule' : 'min-h-0 lg:flex-1'}`}
        >
          {panel}
        </div>
      ) : null}

      {feed ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-rule bg-panel px-2 py-1.5">
            {/*
              The feed's provenance, stated where the feed's rows are. The strip
              at the top of this surface speaks for the book; this speaks for
              these, and the two must never be read as one list.
            */}
            <span aria-hidden="true" className="size-1.5 shrink-0 bg-live" />
            <span className="label text-ink-dim">Live</span>

            <span className="font-data text-micro text-ink-faint">
              {running ? 'Fetching…' : `${rows.length} result${rows.length === 1 ? '' : 's'}`}
            </span>

            {cachedAt ? (
              <span
                className="label text-ink-faint"
                title="Replayed from an earlier identical search — no API call, no cost"
              >
                Replayed
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => onOpen(!open)}
              aria-expanded={open}
              aria-label={open ? 'Hide the results' : 'Show the results'}
              className="ml-auto flex shrink-0 items-center p-0.5 text-ink-faint transition-colors hover:text-ink"
            >
              <IconChevronDown className={`size-3.5 transition-transform ${open ? '' : 'rotate-180'}`} />
            </button>
          </div>

          {open ? (
            <div className="flex shrink-0 items-center gap-1.5 border-b border-rule px-2 py-1">
              {/*
                A native select rather than the product's own menu, and for once
                that is the considered choice. Below `lg` this rail sits on the
                bottom edge of the screen, and every menu in this codebase opens
                downward from its trigger — into the space that is not there. A
                native control's popup is placed by the platform, which always
                has somewhere to put it.
              */}
              <select
                aria-label="Order the results"
                value={sort.key}
                onChange={(event) => onSort(nextSort(sort, event.target.value as SortKey))}
                className="min-w-0 border border-rule bg-ground px-1 py-1 font-data text-micro text-ink outline-none transition-colors hover:border-rule-strong focus:border-signal"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>

              {/*
                Direction is its own control because a select cannot report
                being chosen twice, and flipping the order is the second half of
                sorting — not a setting to go looking for.
              */}
              <button
                type="button"
                onClick={() => onSort({ ...sort, desc: !sort.desc })}
                aria-label={sort.desc ? 'Order from the bottom up' : 'Order from the top down'}
                className="shrink-0 p-0.5 text-ink-faint transition-colors hover:text-ink"
              >
                <IconChevronDown className={`size-3.5 ${sort.desc ? '' : 'rotate-180'}`} />
              </button>

              {selected.size > 0 ? (
                <span className="label shrink-0 truncate text-signal">{selected.size} ticked</span>
              ) : plotted < rows.length ? (
                // Only when it is news. Google withholds a coordinate now and
                // then, and the difference between what was found and what can
                // be pointed at is the one count worth the width.
                <span className="shrink-0 truncate font-data text-micro text-ink-faint">
                  {plotted} on the map
                </span>
              ) : null}

              {/*
                The hand-off. These rows are already bought and already in the
                store the search surface reads, so this is a change of drawing
                and not a second search — nine columns, sortable headers, the
                same ticks, no API call and no cost.
              */}
              <Link
                href="/search"
                title="Draw these same results as the full table. No new search, no cost."
                className="label ml-auto flex shrink-0 items-center gap-1.5 text-ink-faint transition-colors hover:text-signal"
              >
                <IconSearch className="size-3" />
                As table
              </Link>
            </div>
          ) : null}

          {open ? (
            // `min-h-0` is what lets the list scroll inside the rail instead of
            // growing it and pushing its own header off the top.
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((row, index) => (
                <ResultRow
                  key={row.providerPlaceId}
                  row={row}
                  index={index}
                  ticked={selected.has(row.providerPlaceId)}
                  cursored={index === cursor}
                  reading={row.providerPlaceId === focusedResultId}
                  selection={selection}
                  center={center}
                  onRead={onRead}
                  onCursor={onCursor}
                />
              ))}

              {running ? (
                <li className="px-2 py-2">
                  <span className="label animate-pulse text-ink-faint">Fetching next page…</span>
                </li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : null}
    </aside>
  )
}
