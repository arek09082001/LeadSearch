'use client'

import { MapLibreMap, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCallback, useEffect, useRef, useState } from 'react'

import { IconMinus, IconPlus, IconTarget } from '@/components/icons'
import type { LeadBounds, LeadPoint } from '@/lib/leads/types'
import { GERMANY_VIEW, basemapStyle } from '@/lib/map/basemap'
import { circlePolygon, clampRadius, distanceM, type Point } from '@/lib/map/geometry'
import {
  CLICKABLE,
  CLUSTER_CONFIG,
  EMPTY_COLLECTION,
  LAYERS,
  SOURCES,
  clusterCountLayer,
  clusterLayer,
  focusLayer,
  leadLayer,
  leadsToGeoJson,
  resultLayer,
  resultsToGeoJson,
  ringCenterLayer,
  ringFillLayer,
  ringGrabLayer,
  ringLineLayer,
} from '@/lib/map/layers'
import type { SearchRow } from '@/lib/search/types'

/*
 * The canvas, and only the canvas.
 *
 * This component owns one imperative object — a MapLibre map — and nothing else.
 * It holds no idea of what a filter is, never fetches anything, and decides
 * nothing about what a click means beyond which mark was under it. Everything
 * above it is ordinary React state in the console; everything inside it is
 * MapLibre's world, which does not re-render and must not be asked to.
 *
 * That boundary is why the props are data-in / events-out with no `map` handed
 * upward. A parent holding the instance would be one `useEffect` away from
 * mutating the map during a React render, which is the failure mode every
 * map-in-React integration eventually has.
 */

/*
 * ON THE PINNED MAJOR — maplibre-gl 5, not 6, and deliberately.
 *
 * MapLibre does its real work off the main thread: parsing vector tiles,
 * indexing clusters, turning our GeoJSON into buffers. Version 5 ships that
 * worker inlined in the bundle. Version 6 splits it into two sibling ES modules
 * and locates them by resolving a relative path against its own
 * `import.meta.url` — a value that, under this bundler, is a `file://` path. The
 * fallback then hands `new Worker('')` the DOCUMENT's own URL, so the worker
 * loads this page's HTML as if it were JavaScript and dies.
 *
 * What that looks like is the reason for this note: a map that draws NOTHING —
 * no tiles, no pins, no error, no warning — which on this surface reads as "you
 * have no leads here". Emitting the worker as a static asset fixes half of it
 * and leaves the second module unresolvable; making it work needs the two files
 * copied into `public/` by a build step, and a build that skips that step fails
 * exactly as silently as before.
 *
 * So the version whose worker cannot go missing is the one that is used. Before
 * upgrading to 6, load this map and confirm pins actually appear — a green
 * typecheck and a clean console will both lie about this.
 */

/*
 * Where the map was looking, kept for the length of the tab.
 *
 * NOT in the URL, and that is the same decision `LeadBounds` records: a saved
 * view called "No website, Heilbronn" must not also mean "and wherever the map
 * happened to be pointing". But losing the viewport on every visit to a lead's
 * page and back would make the map unusable for the one workflow it exists for,
 * so it lives in session storage — per tab, gone when the tab is.
 */
const VIEW_KEY = 'lead-engine:map-view'

interface StoredView {
  lng: number
  lat: number
  zoom: number
}

function readStoredView(): StoredView | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StoredView>
    if (![value.lng, value.lat, value.zoom].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return null
    }
    return value as StoredView
  } catch {
    // Private mode, a full quota, a hand-edited value — all of them mean the
    // same thing here, which is "open on Germany".
    return null
  }
}

/** How long the map must be still before the book is re-read for the new box. */
const SETTLE_MS = 300

export interface LeadsMapProps {
  /** The book, inside the current box. */
  points: LeadPoint[]
  /** The feed, if a search has run. */
  results: SearchRow[]
  selectedResults: Set<string>
  center: Point | null
  radiusM: number
  /** Whatever the side panel is showing, so the map can ring it. */
  focus: Point | null
  onViewport: (bounds: LeadBounds, zoom: number) => void
  onPickCenter: (point: Point) => void
  onRadius: (metres: number) => void
  onOpenLead: (id: string) => void
  onOpenResult: (providerPlaceId: string) => void
}

export function LeadsMap({
  points,
  results,
  selectedResults,
  center,
  radiusM,
  focus,
  onViewport,
  onPickCenter,
  onRadius,
  onOpenLead,
  onOpenResult,
}: LeadsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  /*
   * The handlers, always current, without re-registering a single listener.
   *
   * MapLibre listeners are attached once to a map that outlives every render.
   * Re-attaching them whenever a callback's identity changed would leak a
   * listener per keystroke in the filter bar above, so the map reads the latest
   * props out of this box instead. Refreshed after every commit rather than
   * during render: nothing reads it while rendering — only MapLibre does, later,
   * from a gesture — so an effect is early by a wide margin.
   */
  const live = useRef({ onViewport, onPickCenter, onRadius, onOpenLead, onOpenResult, center, radiusM })

  useEffect(() => {
    live.current = { onViewport, onPickCenter, onRadius, onOpenLead, onOpenResult, center, radiusM }
  })

  const setData = useCallback((id: string, data: GeoJSON.GeoJSON) => {
    const source = mapRef.current?.getSource(id) as GeoJSONSource | undefined
    // Fire and forget: the source is optional because a data effect can land in
    // the same tick as a teardown, and the redraw is the map's own business.
    source?.setData(data)
  }, [])

  /* --- The instance ------------------------------------------------------ */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const stored = readStoredView()
    const map = new MapLibreMap({
      container,
      style: basemapStyle(),
      center: stored ? [stored.lng, stored.lat] : GERMANY_VIEW.center,
      zoom: stored ? stored.zoom : GERMANY_VIEW.zoom,
      maxZoom: 18,
      /*
       * North stays up. A rotated map makes every label lie about direction and
       * buys nothing on a surface whose job is "where are my leads" — and a
       * two-finger trackpad gesture rotating the country by accident is the
       * single most common way a map like this feels broken.
       */
      dragRotate: false,
      pitchWithRotate: false,
      // The attribution is a licence condition of the tiles, not a credit we
      // may style away. Rendered from the source's own TileJSON so it stays
      // correct if the provider's terms change; restyled in globals.css.
      attributionControl: { compact: false },
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    map.getCanvas().setAttribute('aria-label', 'Map of saved leads')

    /*
     * A tile host that cannot be reached is not a broken map.
     *
     * The points are drawn from our own database and render perfectly well over
     * an empty field. Saying so beats a blank rectangle the operator reads as
     * "no leads here" — which is the one wrong conclusion available.
     *
     * Only failures BEFORE the style has loaded are reported. Those are the
     * source and glyph fetches — the ones that mean the provider is unreachable.
     * After that, an error is one tile that did not arrive, which the map
     * retries on its own and which is not worth a band across the screen.
     */
    let loaded = false
    map.on('error', (event) => {
      /*
       * Logged unconditionally. Registering any `error` listener replaces
       * MapLibre's own, which is the one that writes failures to the console —
       * so without this line a missing tile, a bad expression or a dead glyph
       * range would all fail in total silence, including in development.
       */
      console.warn('[map]', event.error)
      if (loaded) return
      setFailed(
        (previous) => previous ?? (event.error?.message ?? 'The basemap could not be loaded.'),
      )
    })

    map.on('load', () => {
      loaded = true
      map.addSource(SOURCES.leads, {
        type: 'geojson',
        data: EMPTY_COLLECTION,
        ...CLUSTER_CONFIG,
      })
      map.addSource(SOURCES.ring, { type: 'geojson', data: EMPTY_COLLECTION })
      map.addSource(SOURCES.results, { type: 'geojson', data: EMPTY_COLLECTION })
      map.addSource(SOURCES.focus, { type: 'geojson', data: EMPTY_COLLECTION })

      // Order is meaning: the ring is an area and sits under the marks; the
      // focus ring sits over everything, because it answers "which one am I
      // reading" and must never be hidden by a neighbour.
      map.addLayer(ringFillLayer())
      map.addLayer(ringLineLayer())
      map.addLayer(ringGrabLayer())
      map.addLayer(clusterLayer())
      map.addLayer(clusterCountLayer())
      map.addLayer(leadLayer())
      map.addLayer(resultLayer())
      map.addLayer(ringCenterLayer())
      map.addLayer(focusLayer())

      setReady(true)
      report()
    })

    /* --- The box, once the map is still ---------------------------------- */

    let settle: ReturnType<typeof setTimeout> | null = null

    function report() {
      const bounds = map.getBounds()
      live.current.onViewport(
        {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
        map.getZoom(),
      )
    }

    map.on('moveend', () => {
      const { lng, lat } = map.getCenter()
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lng, lat, zoom: map.getZoom() }))
      } catch {
        // Storage being unavailable costs the operator a remembered viewport,
        // which is not worth a single word on screen.
      }
      // A pinch-zoom or a wheel spin is several `moveend`s. Debounced so a
      // gesture is one query rather than a dozen.
      if (settle) clearTimeout(settle)
      settle = setTimeout(report, SETTLE_MS)
    })

    /* --- What a click means ---------------------------------------------- */

    map.on('click', (event) => {
      const layers = CLICKABLE.filter((id) => map.getLayer(id))
      const hits = map.queryRenderedFeatures(event.point, { layers })

      const result = hits.find((feature) => feature.layer.id === LAYERS.results)
      if (result) {
        live.current.onOpenResult(String(result.properties?.id))
        return
      }

      const lead = hits.find((feature) => feature.layer.id === LAYERS.leads)
      if (lead) {
        live.current.onOpenLead(String(lead.properties?.id))
        return
      }

      const cluster = hits.find(
        (feature) =>
          feature.layer.id === LAYERS.clusters || feature.layer.id === LAYERS.clusterCount,
      )
      if (cluster) {
        const source = map.getSource(SOURCES.leads) as GeoJSONSource | undefined
        const clusterId = cluster.properties?.cluster_id as number | undefined
        if (source && clusterId !== undefined) {
          void source
            .getClusterExpansionZoom(clusterId)
            .then((zoom) =>
              map.easeTo({
                center: (cluster.geometry as GeoJSON.Point).coordinates as [number, number],
                zoom,
                duration: 400,
              }),
            )
            .catch(() => {})
        }
        return
      }

      /*
       * Ground. This is the gesture the surface exists for: a point on the map
       * is a place to search, and it costs no geocoding call to name it.
       */
      live.current.onPickCenter({ lat: event.lngLat.lat, lng: event.lngLat.lng })
    })

    /* --- Cursors ---------------------------------------------------------- */

    const canvas = () => map.getCanvas()
    const cursor = (value: string) => {
      canvas().style.cursor = value
    }

    for (const id of [LAYERS.leads, LAYERS.results, LAYERS.clusters, LAYERS.clusterCount]) {
      map.on('mouseenter', id, () => cursor('pointer'))
      map.on('mouseleave', id, () => cursor(''))
    }
    map.on('mouseenter', LAYERS.ringGrab, () => cursor('grab'))
    map.on('mouseleave', LAYERS.ringGrab, () => cursor(''))
    map.on('mouseenter', LAYERS.ringCenter, () => cursor('move'))
    map.on('mouseleave', LAYERS.ringCenter, () => cursor(''))

    /* --- Dragging the ring ------------------------------------------------ */

    /**
     * Follow the pointer until it is let go, and report where it is.
     *
     * The two drags on this map — the edge, which sets the radius, and the
     * centre, which moves the whole ring — differ only in what they do with each
     * position, so they are one function taking that difference.
     *
     * `preventDefault` on the press is what stops the map panning underneath;
     * MapLibre reads it exactly like the DOM does. Movement is taken from the
     * map rather than the window so the coordinates arrive already projected,
     * and the release is listened for on both, because a pointer let go outside
     * the canvas must still end the drag rather than leave the ring stuck to the
     * cursor. Everything is unbound in `stop`, including the listeners that did
     * not fire — a session is hundreds of these.
     */
    function beginDrag(report: (at: { lat: number; lng: number }) => void) {
      const onMove = (moveEvent: { lngLat: { lat: number; lng: number } }) => report(moveEvent.lngLat)
      const stop = () => {
        map.off('mousemove', onMove)
        map.off('touchmove', onMove)
        map.off('mouseup', stop)
        map.off('touchend', stop)
        window.removeEventListener('mouseup', stop)
        cursor('')
      }

      map.on('mousemove', onMove)
      map.on('touchmove', onMove)
      map.on('mouseup', stop)
      map.on('touchend', stop)
      window.addEventListener('mouseup', stop)
      cursor('grabbing')
    }

    function onGrabRing(event: { preventDefault: () => void }) {
      // The centre is read once, at the press: the distance being measured is
      // from where the ring is anchored, and that does not move during a resize.
      const start = live.current.center
      if (!start) return
      event.preventDefault()
      beginDrag((at) => live.current.onRadius(clampRadius(distanceM(start, at))))
    }

    function onGrabCenter(event: { preventDefault: () => void }) {
      event.preventDefault()
      beginDrag((at) => live.current.onPickCenter({ lat: at.lat, lng: at.lng }))
    }

    map.on('mousedown', LAYERS.ringGrab, onGrabRing)
    map.on('touchstart', LAYERS.ringGrab, onGrabRing)
    map.on('mousedown', LAYERS.ringCenter, onGrabCenter)
    map.on('touchstart', LAYERS.ringCenter, onGrabCenter)

    return () => {
      if (settle) clearTimeout(settle)
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  /* --- Data in ----------------------------------------------------------- */

  useEffect(() => {
    if (ready) setData(SOURCES.leads, leadsToGeoJson(points))
  }, [ready, points, setData])

  useEffect(() => {
    if (ready) setData(SOURCES.results, resultsToGeoJson(results, selectedResults))
  }, [ready, results, selectedResults, setData])

  useEffect(() => {
    if (!ready) return
    if (!center) {
      setData(SOURCES.ring, EMPTY_COLLECTION)
      return
    }
    setData(SOURCES.ring, {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: circlePolygon(center, radiusM) },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
        },
      ],
    })
  }, [ready, center, radiusM, setData])

  useEffect(() => {
    if (!ready) return
    setData(
      SOURCES.focus,
      focus
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: [focus.lng, focus.lat] },
              },
            ],
          }
        : EMPTY_COLLECTION,
    )

    /*
     * A mark chosen somewhere other than the canvas brings the canvas to it.
     *
     * The rail beside the field is a list of results the map may not be looking
     * at — sorted by rating, it opens with a business three towns over — and a
     * row that rings a mark nobody can see is a click that appears to do
     * nothing. Only when it is genuinely off screen, and only a pan: clicking a
     * pin that is already in view must not jolt the field out from under the
     * pointer, and changing the zoom would throw away the frame the operator
     * chose. `moveend` then re-reads the book for the new box, as it does for
     * any other movement.
     */
    const map = mapRef.current
    if (!map || !focus) return
    if (!map.getBounds().contains([focus.lng, focus.lat])) {
      map.easeTo({ center: [focus.lng, focus.lat], duration: 400 })
    }
  }, [ready, focus, setData])

  /* --- The three controls the canvas cannot provide ---------------------- */

  return (
    <div className="relative min-h-0 flex-1 bg-ground">
      {/*
        Positioned inline, not with `absolute inset-0`.

        MapLibre's stylesheet sets `.maplibregl-map { position: relative }` and
        arrives unlayered, while Tailwind v4 emits its utilities inside
        `@layer utilities` — and an unlayered rule beats a layered one whatever
        the specificity. The class silently lost, the container collapsed to
        nothing, and the map sized itself to a default. An inline style is the
        one declaration neither of them can outrank.
      */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {failed ? (
        <p
          role="status"
          className="absolute inset-x-0 top-0 z-10 border-b border-rule border-l border-l-signal bg-panel px-3 py-1.5 text-sm text-ink-dim"
        >
          The basemap did not load, so there are no roads or borders under the marks. The
          leads below are read from your own book and are all here.{' '}
          <span className="font-data text-micro text-ink-faint">{failed}</span>
        </p>
      ) : null}

      {/*
        Zoom as buttons as well as gestures. MapLibre's own control is a white
        rounded pill with a drop shadow — three things this world does not have —
        so the map gets the same ruled rectangles every other surface uses.
      */}
      <div className="absolute top-2 right-2 z-10 flex flex-col border border-rule-strong bg-ground/90">
        <MapButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <IconPlus className="size-3.5" />
        </MapButton>
        <span aria-hidden="true" className="h-px bg-rule" />
        <MapButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <IconMinus className="size-3.5" />
        </MapButton>
        <span aria-hidden="true" className="h-px bg-rule" />
        <MapButton
          label="Back to Germany"
          onClick={() => mapRef.current?.easeTo({ ...GERMANY_VIEW, duration: 600 })}
        >
          <IconTarget className="size-3.5" />
        </MapButton>
      </div>
    </div>
  )
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center text-ink-faint transition-colors hover:bg-raise hover:text-ink"
    >
      {children}
    </button>
  )
}
