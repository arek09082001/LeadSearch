'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { IconAlert, IconBook, IconCeiling, IconPulse } from '@/components/icons'
import { FilterBar } from '@/components/leads/filter-bar'
import { SavedViews } from '@/components/leads/saved-views'
import { MapLegend } from '@/components/map/map-legend'
import { MapPanel } from '@/components/map/map-panel'
import { MapSearch } from '@/components/map/map-search'
import { CostReadout } from '@/components/search/cost-readout'
import { SaveBar } from '@/components/search/save-bar'
import { useSearchStream } from '@/components/search/use-search-stream'
import { StatusStrip } from '@/components/shell/status-strip'
import { boundsToSearchParams } from '@/lib/leads/bounds'
import { activeFilterCount, filtersToHref, sameFilters, toSearchParams } from '@/lib/leads/filters'
import type {
  LeadBounds,
  LeadFacets,
  LeadFilters,
  LeadPoint,
  LeadPointSet,
  SavedView,
} from '@/lib/leads/types'
import type { Point } from '@/lib/map/geometry'
import { formatPlaceType } from '@/lib/places-types'
import type { BudgetState } from '@/lib/search/types'

/*
 * The map, assembled.
 *
 * Two things are happening on one surface and the whole arrangement is about
 * keeping them apart. The BOOK is drawn from the same filters the library is
 * drawn from — same URL, same `parseFilters`, same saved views — so a question
 * asked in the table and then looked at here is the same question, not a similar
 * one. The FEED is a search bought at a point, with the same ceiling and the
 * same receipt the search surface has. Amber is the first, green is the second,
 * and nothing on this page is allowed to blur that.
 *
 * The map itself is loaded on the client only. MapLibre reaches for `window`
 * and a WebGL context the moment it is constructed, and there is nothing for a
 * server render to produce anyway — a canvas prerenders to an empty box.
 */

const LeadsMap = dynamic(
  () => import('@/components/map/leads-map').then((module) => module.LeadsMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center bg-ground">
        <span className="label flex items-center gap-2 text-ink-faint">
          <IconPulse className="size-3.5 animate-pulse" />
          Drawing the field
        </span>
      </div>
    ),
  },
)

/** A first ring the operator will usually widen rather than a guess at nothing. */
const DEFAULT_RADIUS_M = 2_500

/**
 * How much more than the viewport to ask for.
 *
 * A map that fetched exactly what is on screen would go back to the database on
 * every nudge of the mouse. Asking for a box a quarter larger in each direction
 * means the ordinary small pan is answered from what is already in hand, and the
 * query only runs when the operator has actually gone somewhere.
 */
const PAD = 0.25

function pad(bounds: LeadBounds): LeadBounds {
  // A box crossing the antimeridian is left exactly as it is: widening it would
  // have to reason about which side of the seam each edge is on, for a case this
  // book is never in.
  if (bounds.west > bounds.east) return bounds

  const dLat = (bounds.north - bounds.south) * PAD
  const dLng = (bounds.east - bounds.west) * PAD

  return {
    north: Math.min(90, bounds.north + dLat),
    south: Math.max(-90, bounds.south - dLat),
    west: Math.max(-180, bounds.west - dLng),
    east: Math.min(180, bounds.east + dLng),
  }
}

function covers(outer: LeadBounds, inner: LeadBounds): boolean {
  if (outer.west > outer.east || inner.west > inner.east) return false
  return (
    outer.north >= inner.north &&
    outer.south <= inner.south &&
    outer.west <= inner.west &&
    outer.east >= inner.east
  )
}

export function MapConsole({
  filters,
  facets,
  views,
  libraryTotal,
  initialBudget,
  budgetError,
}: {
  filters: LeadFilters
  facets: LeadFacets
  views: SavedView[]
  libraryTotal: number
  /**
   * Null when the usage ledger could not be read. The map still draws — the
   * book is in our own database and owes Google nothing — but no search may run
   * without a ceiling to enforce, and the band below says so.
   */
  initialBudget: BudgetState | null
  budgetError: string | null
}) {
  const router = useRouter()

  /* --- The book --------------------------------------------------------- */

  const [bounds, setBounds] = useState<LeadBounds | null>(null)
  const [pointSet, setPointSet] = useState<LeadPointSet | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)

  /* --- The feed --------------------------------------------------------- */

  const { state, run, cancel, setBudget, markSaved } = useSearchStream(initialBudget)
  const [center, setCenter] = useState<Point | null>(null)
  const [radiusM, setRadiusM] = useState(DEFAULT_RADIUS_M)
  const [category, setCategory] = useState('')
  const [words, setWords] = useState('')
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set())

  /*
   * Choosing a trade writes its name into the words field.
   *
   * The commonest search on this surface is "this trade, in this circle", and
   * making the operator type a word he has just picked from a list is the kind
   * of small tax that makes a tool feel unfinished. It is a prefill and not a
   * lock: anything he has typed himself survives a change of category, because
   * the only thing it will overwrite is a field that is empty or still holding
   * the previous category's own label.
   */
  const onCategory = useCallback(
    (token: string) => {
      if (words === '' || words === formatPlaceType(category)) {
        setWords(token ? formatPlaceType(token) : '')
      }
      setCategory(token)
    },
    [words, category],
  )

  /* --- What the panel is reading ---------------------------------------- */

  const [focusLead, setFocusLead] = useState<LeadPoint | null>(null)
  const [focusResultId, setFocusResultId] = useState<string | null>(null)

  /** Owned here rather than in the views bar, because `s` is what opens it. */
  const [naming, setNaming] = useState(false)

  const query = toSearchParams(filters).toString()

  /*
   * The map's URL is the library's URL, through the library's own codec.
   *
   * Same parse, same write, same page-one reset on a narrowing — the only
   * difference is which route renders it. That is what "same state, different
   * drawing" has to mean if a view saved from the table is going to apply here
   * without a second thought.
   */
  const navigate = useCallback(
    (next: LeadFilters) => router.push(filtersToHref({ ...next, page: 1 }, '/map')),
    [router],
  )

  /* --- Reading the book for the current box ------------------------------ */

  /** The box the last answer covered, so an ordinary pan asks nothing. */
  const covered = useRef<{ key: string; bounds: LeadBounds; truncated: boolean } | null>(null)

  useEffect(() => {
    if (!bounds) return

    const cached = covered.current
    // A truncated answer is never reused: the box held more leads than the
    // ceiling, so a smaller box inside it is a different, better answer.
    if (cached && cached.key === query && !cached.truncated && covers(cached.bounds, bounds)) {
      // Cleared explicitly. Panning inside the covered box while a fetch is
      // still running aborts that fetch, and its `finally` deliberately does not
      // fire on an abort — without this line the strip would read "Reading…"
      // for the rest of the session.
      setReading(false)
      return
    }

    const box = pad(bounds)
    const params = new URLSearchParams(query)
    for (const [key, value] of boundsToSearchParams(box)) params.set(key, value)

    const controller = new AbortController()
    setReading(true)
    setReadError(null)

    fetch(`/api/leads/geo?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error ?? 'The map could not be read.')
        const set = body as LeadPointSet
        covered.current = { key: query, bounds: box, truncated: set.truncated }
        setPointSet(set)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setReadError(error instanceof Error ? error.message : 'The map could not be read.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setReading(false)
      })

    return () => controller.abort()
  }, [bounds, query])

  /*
   * A new question empties the old answer.
   *
   * Adjusted during render rather than in an effect, exactly as the library's
   * console does it: an effect would let one frame paint the old pins under the
   * new filters, which on a map reads as leads that do not match what the bar
   * says.
   */
  const [lastQuery, setLastQuery] = useState(query)
  if (lastQuery !== query) {
    setLastQuery(query)
    setFocusLead(null)
  }

  /* --- Clicks ------------------------------------------------------------ */

  const points = useMemo(() => pointSet?.points ?? [], [pointSet])

  /** Results the map can put somewhere. Google withholds a coordinate now and then. */
  const plotted = useMemo(
    () => state.rows.filter((row) => row.lat !== null && row.lng !== null).length,
    [state.rows],
  )

  const onOpenLead = useCallback(
    (id: string) => {
      const point = points.find((entry) => entry.id === id)
      if (!point) return
      setFocusLead(point)
      setFocusResultId(null)
    },
    [points],
  )

  const toggleResult = useCallback((placeId: string) => {
    setSelectedResults((previous) => {
      const next = new Set(previous)
      if (next.has(placeId)) next.delete(placeId)
      else next.add(placeId)
      return next
    })
  }, [])

  /*
   * Clicking a green mark both selects it and opens it.
   *
   * Two effects from one gesture, which is normally a smell — but selecting
   * thirty businesses is the actual job here, and a flow that costs a click to
   * read and a second click to tick would be a flow nobody uses twice. Both
   * halves are visible immediately (an amber ring on the mark, the panel beside
   * it) and both are undone by clicking again.
   */
  const onOpenResult = useCallback(
    (placeId: string) => {
      setFocusResultId(placeId)
      setFocusLead(null)
      toggleResult(placeId)
    },
    [toggleResult],
  )

  const onPickCenter = useCallback((point: Point) => {
    setCenter(point)
    setFocusLead(null)
    setFocusResultId(null)
  }, [])

  const search = useCallback(
    (refresh: boolean) => {
      const text = words.trim()
      if (!center || (!category && !text)) return
      // A new result set invalidates the old ticks, exactly as on the search
      // surface: they would otherwise save businesses no longer on screen.
      setSelectedResults(new Set())
      setFocusResultId(null)
      /*
       * `location` is deliberately never sent: this surface has a point, and a
       * point is what `center` is for. Sending both would ask the provider to
       * fold a place name into the text as well, which is the geocoding this
       * whole surface exists to avoid paying for.
       */
      void run({ query: text, category: category || undefined, center, radiusM, refresh })
    },
    [center, category, words, radiusM, run],
  )

  /*
   * The keyboard for this surface, which is two keys.
   *
   * `s` saves the question as a view, because the views bar above says it does —
   * the same binding the library has, on the same bar, for the same act. Escape
   * undoes ONE decision at a time, most recent first: the naming field, then the
   * panel, then the search centre. Undoing the whole session with one press is
   * what makes an operator stop using Escape.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing = target?.matches('input, textarea, select, [contenteditable]')

      if (event.key === 'Escape') {
        if (naming) setNaming(false)
        else if (focusLead || focusResultId) {
          setFocusLead(null)
          setFocusResultId(null)
        } else if (center) setCenter(null)
        return
      }

      if (event.key === 's' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // The same condition the views bar draws its button under: there is
        // something to name, and it is not already named.
        if (
          activeFilterCount(filters) > 0 &&
          !views.some((view) => sameFilters(view.filters, filters))
        ) {
          event.preventDefault()
          setNaming(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [naming, focusLead, focusResultId, center, filters, views])

  const focusResult = focusResultId
    ? (state.rows.find((row) => row.providerPlaceId === focusResultId) ?? null)
    : null

  const focusPoint: Point | null = focusResult
    ? focusResult.lat !== null && focusResult.lng !== null
      ? { lat: focusResult.lat, lng: focusResult.lng }
      : null
    : focusLead
      ? { lat: focusLead.lat, lng: focusLead.lng }
      : null

  const detail = reading
    ? 'Reading…'
    : pointSet
      ? `${points.length.toLocaleString('de-DE')} in view · ${libraryTotal.toLocaleString('de-DE')} saved`
      : `${libraryTotal.toLocaleString('de-DE')} saved`

  const narrowed = activeFilterCount(filters)

  return (
    <>
      <SavedViews
        views={views}
        filters={filters}
        onApply={(next) => navigate(next)}
        onChanged={() => router.refresh()}
        naming={naming}
        onNaming={setNaming}
      />

      <FilterBar
        filters={filters}
        facets={facets}
        onChange={(patch) => navigate({ ...filters, ...patch })}
      />

      <StatusStrip provenance="book" detail={detail}>
        {reading ? (
          <span className="label flex items-center gap-1.5 text-ink-faint">
            <IconPulse className="size-3.5 animate-pulse" />
            Reading
          </span>
        ) : null}
        <span className="hidden font-data text-micro text-ink-faint xl:inline">
          esc closes · leads without coordinates are off the map
        </span>
      </StatusStrip>

      {/*
        The receipt stays on screen whether or not a search has run. A map is a
        surface you can leave open for an hour, and the one number that has to
        remain true the whole time is what is left of the ceiling.
      */}
      {state.budget ? (
        <CostReadout
          budget={state.budget}
          searchCostUsd={state.searchCostUsd}
          requests={state.requests}
          estimateUsd={state.estimateUsd}
          onCeilingChange={setBudget}
        />
      ) : (
        <div className="flex items-start gap-2 border-b border-rule border-l border-l-signal bg-panel px-3 py-2">
          <IconCeiling className="mt-0.5 size-3.5 shrink-0 text-signal" />
          <div className="min-w-0">
            <p className="label text-signal">Searching is unavailable</p>
            <p className="mt-0.5 text-sm text-ink-dim">
              The API usage ledger could not be read, so the spending ceiling cannot be
              enforced and no search will run. The book below is read from this
              application&rsquo;s own database and is unaffected.{' '}
              {budgetError ? (
                <span className="font-data text-micro text-ink-faint">{budgetError}</span>
              ) : null}
            </p>
          </div>
        </div>
      )}

      {/*
        The ceiling stopping a search is the instrument working, so `signal` and
        not `alert` — the same band, in the same words, as the search surface.
      */}
      {state.blocked ? (
        <div className="flex items-start gap-2 border-b border-rule border-l border-l-signal bg-panel px-3 py-2">
          <IconCeiling className="mt-0.5 size-3.5 shrink-0 text-signal" />
          <div className="min-w-0">
            <p className="label text-signal">Monthly ceiling reached</p>
            <p className="mt-0.5 text-sm text-ink-dim">
              {state.blocked} Anything fetched before the stop is on the map and is
              already paid for.
            </p>
          </div>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-rule border-l border-l-alert bg-panel px-3 py-2"
        >
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <p className="text-sm wrap-anywhere text-ink-dim">
            <span className="label mr-1.5 text-alert">Search failed</span>
            {state.error}
          </p>
        </div>
      ) : null}

      {/*
        THE TRUNCATION NOTICE.
        `queryLeadPoints` keeps the highest-scoring two thousand and drops the
        rest, which is the right cap and the wrong thing to do silently: a map
        that quietly stops drawing looks exactly like a map with nothing left to
        draw. So it says so, and it says which ones survived, because that is
        what tells the operator whether zooming in is worth his time.
      */}
      {pointSet?.truncated ? (
        <div className="flex items-start gap-2 border-b border-rule border-l border-l-signal bg-panel px-3 py-2">
          <IconBook className="mt-0.5 size-3.5 shrink-0 text-signal" />
          <div className="min-w-0">
            <p className="label text-signal">More leads here than are drawn</p>
            <p className="mt-0.5 text-sm text-ink-dim">
              This view holds more than {pointSet.limit.toLocaleString('de-DE')} matching
              leads. The {pointSet.limit.toLocaleString('de-DE')} highest-scoring are on the
              map — zoom in, or narrow the filters, to see the rest.
            </p>
          </div>
        </div>
      ) : null}

      {readError ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-rule border-l border-l-alert bg-panel px-3 py-2"
        >
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <p className="text-sm wrap-anywhere text-ink-dim">
            <span className="label mr-1.5 text-alert">The map could not be read</span>
            {readError} The marks below are from the last box that answered.
          </p>
        </div>
      ) : null}

      {/*
        The same selection bar the search surface uses, writing through the same
        save route. There is deliberately no second way to save from the map:
        one path into the book means one set of outcomes, one receipt, and one
        thing to get right.
      */}
      <SaveBar
        rows={state.rows}
        selected={selectedResults}
        onSelect={setSelectedResults}
        searchId={state.searchId}
        // No tick boxes on a field of marks, so no shift-click run to advertise.
        rangeHint={false}
        onSaved={(items) => {
          markSaved(items)
          // The saved leads are now in the book and belong on the map as amber.
          // Forgetting the covered box is what makes the next idle moment
          // re-read it rather than trusting an answer that predates the save.
          covered.current = null
          setBounds((previous) => (previous ? { ...previous } : previous))
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative flex min-h-[22rem] flex-1 flex-col">
          <LeadsMap
            points={points}
            results={state.rows}
            selectedResults={selectedResults}
            center={center}
            radiusM={radiusM}
            focus={focusPoint}
            onViewport={setBounds}
            onPickCenter={onPickCenter}
            onRadius={setRadiusM}
            onOpenLead={onOpenLead}
            onOpenResult={onOpenResult}
          />

          {/*
            No ledger, no search. A panel offering a billable action whose
            ceiling cannot be read would be the one piece of chrome in this
            product that lies about money.
          */}
          {initialBudget ? (
            <MapSearch
              center={center}
              radiusM={radiusM}
              category={category}
              query={words}
              running={state.status === 'running'}
              resultCount={state.rows.length}
              plottedCount={plotted}
              cachedAt={state.cachedAt}
              onRadius={setRadiusM}
              onCategory={onCategory}
              onQuery={setWords}
              onClearCenter={() => setCenter(null)}
              onSearch={search}
              onCancel={cancel}
            />
          ) : null}

          <MapLegend live={state.rows.length > 0} />

          {/*
            An empty box is two different facts with two different recoveries,
            and guessing wrong costs the operator a trip to the wrong page.
          */}
          {!reading && pointSet && points.length === 0 ? (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 z-10 mx-auto max-w-[46ch] -translate-y-1/2 px-4 text-center text-sm text-ink-faint">
              {libraryTotal === 0
                ? 'Nothing is in the book yet. Set a centre, pick a category and search — what you save appears here in amber.'
                : narrowed > 0
                  ? `No saved lead in this view matches the ${narrowed} filter${narrowed === 1 ? '' : 's'} above.`
                  : 'No saved lead in this view. Zoom out, or search here to find some.'}
            </p>
          ) : null}
        </div>

        <MapPanel
          point={focusLead}
          result={focusResult}
          selected={focusResultId ? selectedResults.has(focusResultId) : false}
          onToggleResult={() => focusResultId && toggleResult(focusResultId)}
          onClose={() => {
            setFocusLead(null)
            setFocusResultId(null)
          }}
        />
      </div>
    </>
  )
}
