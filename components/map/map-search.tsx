'use client'

import { IconClose, IconRefresh, IconSearch } from '@/components/icons'
import { CategorySelect } from '@/components/search/category-select'
import { CommandButton } from '@/components/ui/command-button'
import { INPUT } from '@/components/ui/controls'
import { RADIUS_LIMITS, formatPoint, formatRadius, type Point } from '@/lib/map/geometry'
import { formatPlaceType } from '@/lib/places-types'

/*
 * Searching without typing a place.
 *
 * This is the reason the map exists rather than being a second view of the
 * table. A location typed as text has to be geocoded, which is a billable Google
 * call before the search itself has started; a point on the map is the answer
 * that call would have bought. `SearchInput.center` carries it straight through
 * — the provider, the replay cache and the spend guard cannot tell which way the
 * centre arrived — so the same search costs one request fewer, which at a
 * ceiling of zero is the difference between running and being refused.
 *
 * It sits on the canvas rather than in a band above it because everything it
 * describes is on the canvas: the centre is a mark, the radius is a ring, and a
 * form six inches above the thing it is aiming at is a form you have to
 * translate. It stays narrow and ruled so it reads as an instrument's corner
 * rather than as a card floating over a map.
 */

/** The same round numbers the typed search offers. The ring can land anywhere. */
const RADIUS_OPTIONS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000]

export function MapSearch({
  center,
  radiusM,
  category,
  query,
  running,
  resultCount,
  plottedCount,
  cachedAt,
  onRadius,
  onCategory,
  onQuery,
  onClearCenter,
  onSearch,
  onCancel,
}: {
  center: Point | null
  radiusM: number
  category: string
  /** Free text, prefilled from the category and editable. Empty is a real choice. */
  query: string
  running: boolean
  /** How many live rows the search returned, so the panel states its provenance. */
  resultCount: number
  /**
   * How many of them the map could actually draw.
   *
   * Google does not always give a coordinate, and a business without one has no
   * place on a map. Reporting only the total would make the map quietly show
   * fewer businesses than the search found, which is the same silent subtraction
   * the point ceiling is made to announce.
   */
  plottedCount: number
  /** Set when the result set was replayed from an earlier identical search. */
  cachedAt: string | null
  onRadius: (metres: number) => void
  onCategory: (token: string) => void
  onQuery: (text: string) => void
  onClearCenter: () => void
  onSearch: (refresh: boolean) => void
  onCancel: () => void
}) {
  const canSearch = Boolean(center && (category || query.trim()))

  return (
    /*
      Full width along the top on a phone, a narrow corner column from `sm` up.
      An overlay this size in the corner of a 360px screen covers most of the
      field it is aiming at; across the top it costs a strip and leaves the map
      below it whole. Desktop-primary, phone-tolerant, as the rest of the
      product is.
    */
    <div className="absolute inset-x-2 top-2 z-10 border border-rule-strong bg-ground/95 sm:right-auto sm:w-[17.5rem]">
      <div className="flex items-center gap-2 border-b border-rule bg-panel px-2.5 py-1.5">
        <span className="label flex items-center gap-1.5 text-ink-dim">
          <IconSearch className="size-3.5" />
          Search here
        </span>
        {center ? (
          <button
            type="button"
            onClick={onClearCenter}
            className="ml-auto flex items-center gap-1 p-0.5 text-ink-faint transition-colors hover:text-alert"
            aria-label="Drop the search centre"
            title="Drop the search centre"
          >
            <IconClose className="size-3" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        {/*
          The centre, stated as coordinates rather than as an invented address.
          lib/search/run.ts labels a clicked point exactly this way, and for the
          same reason: nothing resolved a name here, so putting one on it would
          be the surface claiming a geocode it never made.
        */}
        <div className="flex items-baseline gap-2">
          <span className="label shrink-0 text-ink-faint">Centre</span>
          {center ? (
            <span className="truncate font-data text-micro text-ink">{formatPoint(center)}</span>
          ) : (
            <span className="text-sm text-ink-faint">Click the map to set one</span>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="label flex items-baseline justify-between gap-1.5 text-ink-faint">
            Radius
            <span className="font-data text-micro normal-case text-ink-dim">
              {formatRadius(radiusM)}
            </span>
          </span>
          <select
            value={RADIUS_OPTIONS.includes(radiusM) ? radiusM : 'custom'}
            disabled={!center}
            onChange={(event) => {
              // The dragged entry below is a readout, not a choice. Picking it
              // again would parse to NaN and take the ring off the map.
              const metres = Number(event.target.value)
              if (Number.isFinite(metres)) onRadius(metres)
            }}
            title={center ? 'Or drag the ring on the map' : 'Set a centre first'}
            className={INPUT}
          >
            {/*
              The ring is a continuous control and the menu is a discrete one, so
              a dragged radius gets an entry of its own rather than snapping the
              select back to the nearest round number and lying about the ring.
            */}
            {!RADIUS_OPTIONS.includes(radiusM) ? (
              <option value="custom">{formatRadius(radiusM)} — dragged</option>
            ) : null}
            {RADIUS_OPTIONS.map((metres) => (
              <option key={metres} value={metres}>
                {formatRadius(metres)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-faint">Category</span>
          <CategorySelect value={category} onChange={onCategory} disabled={running} />
        </label>

        {/*
          Words, prefilled with the trade's own name.

          Picking a category writes its label in here so the commonest search —
          "this trade, in this circle" — needs no typing at all, and it stays
          editable because "Zahnarzt Notdienst" is a different question from
          "Zahnarzt". The prefill never overwrites something typed.

          Clearing it is a real choice rather than an omission, and the line
          underneath says what it changes: with no words Google answers the
          circle in one billable request; with words it searches wider and pages,
          which costs more than one. On a $0 ceiling that belongs on screen
          before the button, not in the receipt after it.
        */}
        <label className="flex flex-col gap-1">
          <span className="label text-ink-faint">Words</span>
          <input
            type="text"
            value={query}
            maxLength={200}
            disabled={running}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={category ? formatPlaceType(category) : 'Zahnarzt'}
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </label>

        <p className="text-sm text-ink-faint">
          {query.trim()
            ? 'Words search wider than the circle and page — more than one billable request.'
            : 'No words: one request, everything of this type inside the circle.'}
        </p>

        <div className="flex items-center gap-2">
          {running ? (
            <CommandButton type="button" onClick={onCancel} className="flex-1 justify-center">
              Stop
            </CommandButton>
          ) : (
            <>
              <CommandButton
                type="button"
                variant="primary"
                disabled={!canSearch}
                onClick={() => onSearch(false)}
                className="flex-1 justify-center"
                title={
                  canSearch
                    ? undefined
                    : center
                      ? 'Pick a category, or type what to look for'
                      : 'Click the map to set a centre'
                }
              >
                <IconSearch className="size-3.5" />
                Search
              </CommandButton>
              {/*
                Same rule as the typed search: paying again for data we already
                have is a separate control, never a switch left on from last time.
              */}
              <CommandButton
                type="button"
                disabled={!canSearch}
                onClick={() => onSearch(true)}
                title="Ignore the cached result set and pay for fresh data"
                aria-label="Search again with fresh data"
              >
                <IconRefresh className="size-3.5" />
              </CommandButton>
            </>
          )}
        </div>

        {/*
          The feed's provenance, next to the feed's own controls. The strip above
          the map speaks for the book; this speaks for the green marks, and one
          of the two is always transient.
        */}
        {resultCount > 0 || running ? (
          <p className="flex items-center gap-1.5 border-t border-rule pt-2 text-sm text-ink-faint">
            <span aria-hidden="true" className="size-1.5 shrink-0 bg-live" />
            {running ? (
              'Fetching…'
            ) : (
              <>
                <span className="font-data text-micro text-ink-dim">{resultCount}</span>
                {cachedAt ? ' replayed, no cost' : ' live results — transient'}
                {resultCount > plottedCount ? (
                  <span title="Google gave these businesses no coordinates. They are in the selection and can be saved; they simply cannot be drawn.">
                    {' '}
                    · {resultCount - plottedCount} not mappable
                  </span>
                ) : null}
              </>
            )}
          </p>
        ) : null}
      </div>

      {/* Stated where the money is spent. The radius caps are the route's. */}
      <p className="border-t border-rule px-2.5 py-1 font-data text-micro text-ink-faint">
        {formatRadius(RADIUS_LIMITS.min)}–{formatRadius(RADIUS_LIMITS.max)} · billed per
        search
      </p>
    </div>
  )
}
