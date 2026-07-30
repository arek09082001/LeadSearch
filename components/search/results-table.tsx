'use client'

import { useMemo, useState } from 'react'

import { IconChevronDown, IconExternal } from '@/components/icons'
import { Checkbox } from '@/components/ui/controls'
import { formatPlaceType } from '@/lib/places-types'
import type { SearchRow } from '@/lib/search/types'

/*
 * The feed. Every horizontal pixel is a column the operator wants, so the table
 * runs edge to edge and the header is the only thing that stays put.
 *
 * Two readings are encoded in the row itself, because they are the two
 * decisions being made at speed:
 *
 *   "no website"  -> the reason to look. Carried by BRIGHTNESS, not a fourth
 *                    colour: `No site` sits at full `ink` while a business that
 *                    already has one fades its domain back to `ink-faint`. The
 *                    eye lands on the prospects without anything shouting.
 *   "already mine" -> the reason not to look. A 1px `signal` rule down the left
 *                    edge (signal is the book, everywhere in this product) and
 *                    the rest of the row dropped to `ink-faint`, so a saved
 *                    lead is legible but visibly not up for re-evaluation.
 *
 * Neither uses `live` or `alert`. A business with no website is an opportunity,
 * not a failure, and spending the red on it would leave nothing to say when
 * something actually breaks.
 */

type SortKey = 'rank' | 'name' | 'rating' | 'reviews' | 'web'

interface Column {
  key: SortKey | null
  label: string
  className: string
  /** Numeric columns sort high-to-low first; text sorts A-to-Z first. */
  descFirst?: boolean
}

const COLUMNS: Column[] = [
  // The selection column. No label: the header holds the select-all box, and a
  // word above a checkbox would be a caption for a control that explains itself.
  { key: null, label: '', className: 'w-8 pl-3' },
  { key: 'rank', label: '#', className: 'w-10 text-right' },
  { key: 'name', label: 'Business', className: 'min-w-[14rem]' },
  { key: null, label: 'Category', className: 'hidden w-40 xl:table-cell' },
  { key: 'rating', label: 'Rating', className: 'w-16 text-right', descFirst: true },
  { key: 'reviews', label: 'Reviews', className: 'w-20 text-right', descFirst: true },
  { key: 'web', label: 'Website', className: 'w-44' },
  { key: null, label: 'Phone', className: 'hidden w-36 lg:table-cell' },
  { key: null, label: 'Address', className: 'hidden min-w-[12rem] md:table-cell' },
  { key: null, label: '', className: 'w-8' },
]

/** `https://www.praxis-mueller.de/termine` -> `praxis-mueller.de`. */
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function ResultsTable({
  rows,
  running,
  selected,
  onSelect,
}: {
  rows: SearchRow[]
  running: boolean
  /** Place ids currently ticked. Owned above, because the save bar acts on them. */
  selected: Set<string>
  /** Replaces the whole selection — the caller decides what a click means. */
  onSelect: (next: Set<string>) => void
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rank', desc: false })

  const sorted = useMemo(() => {
    const copy = rows.map((row, index) => ({ row, index }))
    const direction = sort.desc ? -1 : 1

    copy.sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return direction * (a.row.name ?? '').localeCompare(b.row.name ?? '', 'de')
        case 'rating':
          // No rating is not a zero rating; unrated businesses sink either way
          // rather than pretending to be the worst-reviewed in town.
          return direction * ((a.row.rating ?? -1) - (b.row.rating ?? -1))
        case 'reviews':
          return direction * ((a.row.userRatingCount ?? -1) - (b.row.userRatingCount ?? -1))
        case 'web':
          // The one sort the product exists for: no-website first.
          return direction * (Number(Boolean(a.row.website)) - Number(Boolean(b.row.website)))
        default:
          return direction * (a.index - b.index)
      }
    })

    return copy.map((entry) => entry.row)
  }, [rows, sort])

  function toggle(column: Column) {
    if (!column.key) return
    setSort((prev) =>
      prev.key === column.key
        ? { key: prev.key, desc: !prev.desc }
        : { key: column.key!, desc: Boolean(column.descFirst) },
    )
  }

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.providerPlaceId))
  const someSelected = !allSelected && rows.some((row) => selected.has(row.providerPlaceId))

  function toggleRow(placeId: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(placeId)
    else next.delete(placeId)
    onSelect(next)
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-rule-strong bg-ground">
            {COLUMNS.map((column, columnIndex) => {
              const active = column.key && sort.key === column.key
              return (
                <th
                  key={column.label || `col-${columnIndex}`}
                  scope="col"
                  aria-sort={
                    active ? (sort.desc ? 'descending' : 'ascending') : undefined
                  }
                  className={`label px-2 py-1.5 font-semibold ${column.className}`}
                >
                  {columnIndex === 0 ? (
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      disabled={rows.length === 0}
                      onChange={(checked) =>
                        onSelect(
                          checked ? new Set(rows.map((row) => row.providerPlaceId)) : new Set(),
                        )
                      }
                      label={allSelected ? 'Clear selection' : 'Select every result'}
                    />
                  ) : column.key ? (
                    <button
                      type="button"
                      onClick={() => toggle(column)}
                      className={`label inline-flex items-center gap-1 transition-colors ${
                        active ? 'text-signal' : 'text-ink-faint hover:text-ink-dim'
                      }`}
                    >
                      {column.label}
                      {/* The authored chevron, flipped — not an arrow glyph. */}
                      {active ? (
                        <IconChevronDown
                          className={`size-3 ${sort.desc ? '' : 'rotate-180'}`}
                        />
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
          {sorted.map((row, index) => {
            const saved = Boolean(row.savedLeadId)
            const ticked = selected.has(row.providerPlaceId)
            return (
              <tr
                key={row.providerPlaceId}
                // `tick` fires once on mount, so only genuinely new rows flash as
                // a page lands. Re-sorting reorders the same keys and stays still.
                className={`tick group transition-colors ${
                  saved ? 'text-ink-faint' : 'text-ink-dim'
                } ${ticked ? 'bg-raise' : ''} hover:bg-raise`}
              >
                <td
                  className={`py-1.5 pl-3 ${
                    // The saved rule moves to the selection column now that it is
                    // the leftmost thing in the row; the mark still means the
                    // same and still sits on the row's edge.
                    saved ? 'border-l border-signal' : 'border-l border-transparent'
                  }`}
                >
                  <Checkbox
                    checked={ticked}
                    onChange={(checked) => toggleRow(row.providerPlaceId, checked)}
                    label={`Select ${row.name ?? 'this business'}`}
                  />
                </td>

                <td className="px-2 py-1.5 text-right font-data text-micro text-ink-faint">
                  {index + 1}
                </td>

                <td className="px-2 py-1.5">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`truncate ${saved ? 'text-ink-faint' : 'text-ink'}`}
                      title={row.name ?? undefined}
                    >
                      {row.name ?? '—'}
                    </span>
                    {saved ? (
                      <span
                        className="label shrink-0 text-signal"
                        title={`Already saved${row.savedStatus ? ` — ${row.savedStatus}` : ''}`}
                      >
                        In book{row.savedStatus ? ` · ${row.savedStatus}` : ''}
                      </span>
                    ) : null}
                  </div>
                </td>

                <td className="hidden truncate px-2 py-1.5 text-sm xl:table-cell">
                  {row.primaryType ? formatPlaceType(row.primaryType) : '—'}
                </td>

                <td className="px-2 py-1.5 text-right font-data text-sm">
                  {row.rating === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    row.rating.toFixed(1)
                  )}
                </td>

                <td className="px-2 py-1.5 text-right font-data text-sm">
                  {row.userRatingCount === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    row.userRatingCount.toLocaleString('de-DE')
                  )}
                </td>

                <td className="px-2 py-1.5">
                  {row.website ? (
                    <a
                      href={row.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={row.website}
                      className="block truncate font-data text-sm text-ink-faint underline decoration-rule-strong underline-offset-2 transition-colors hover:text-ink-dim hover:decoration-ink-faint"
                    >
                      {hostname(row.website)}
                    </a>
                  ) : (
                    // The whole reason this surface exists, at full brightness.
                    <span className={`label ${saved ? 'text-ink-dim' : 'text-ink'}`}>No site</span>
                  )}
                </td>

                <td className="hidden truncate px-2 py-1.5 font-data text-sm lg:table-cell">
                  {row.phone ?? <span className="text-ink-faint">—</span>}
                </td>

                <td
                  className="hidden max-w-0 truncate px-2 py-1.5 text-sm md:table-cell"
                  title={row.formattedAddress ?? undefined}
                >
                  {row.formattedAddress ?? '—'}
                </td>

                <td className="px-2 py-1.5">
                  {row.mapsUri ? (
                    <a
                      href={row.mapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${row.name ?? 'this business'} on Google Maps`}
                      className="inline-flex text-ink-ghost transition-colors group-hover:text-ink-faint hover:!text-signal"
                    >
                      <IconExternal className="size-3.5" />
                    </a>
                  ) : null}
                </td>
              </tr>
            )
          })}

          {running ? (
            <tr>
              <td colSpan={COLUMNS.length} className="px-2 py-2">
                <span className="label animate-pulse text-ink-faint">Fetching next page…</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
