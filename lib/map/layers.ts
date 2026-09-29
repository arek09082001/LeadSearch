import type { LayerSpecification } from 'maplibre-gl'

import type { LeadPoint } from '@/lib/leads/types'
import { MAP_COLORS, scoreRamp } from '@/lib/map/palette'
import type { SearchRow } from '@/lib/search/types'

/*
 * What the map draws on top of the ground: the book, the feed, and the ring.
 *
 * Kept out of the component for the same reason `basemap.ts` is: these are data,
 * not behaviour, and the component that owns the canvas should be readable as
 * wiring rather than as three hundred lines of style expressions.
 *
 * The colour rule is the product's, restated in a canvas: AMBER IS THE BOOK,
 * GREEN IS LIVE. A saved lead is amber to the degree it scores; a Google result
 * is green because it is transient and will expire whether or not anybody saves
 * it. Nothing on this map may blur that, which is why a search result that is
 * already saved is drawn as a dimmed green result rather than as an amber lead —
 * it is still the feed's row; the book merely already knows about it.
 */

export const SOURCES = {
  leads: 'lead-points',
  results: 'search-results',
  ring: 'search-ring',
  focus: 'focus-mark',
} as const

export const LAYERS = {
  clusters: 'lead-clusters',
  clusterCount: 'lead-cluster-count',
  leads: 'lead-dots',
  results: 'result-dots',
  ringFill: 'ring-fill',
  ringLine: 'ring-line',
  ringGrab: 'ring-grab',
  ringCenter: 'ring-center',
  focus: 'focus-ring',
} as const

/** Layers a click may land on, in the order the click is resolved. */
export const CLICKABLE = [
  LAYERS.results,
  LAYERS.leads,
  LAYERS.clusters,
  LAYERS.clusterCount,
] as const

/** The score of a feature, with "never scored" folded to the bottom of the ramp. */
const SCORE: unknown = ['coalesce', ['get', 'score'], 0]

/**
 * A dot's radius: bigger with zoom, and bigger with score at every zoom.
 *
 * Size is the second channel after colour, and it carries the same fact. That is
 * deliberate redundancy rather than waste — a screen of two thousand dots is
 * read peripherally, and a high scorer that is both brighter AND larger survives
 * being glanced at, where either alone does not.
 */
const DOT_RADIUS: unknown = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  ['interpolate', ['linear'], SCORE, 0, 2, 100, 3.5],
  9,
  ['interpolate', ['linear'], SCORE, 0, 3, 100, 5],
  14,
  ['interpolate', ['linear'], SCORE, 0, 4.5, 100, 7.5],
  18,
  ['interpolate', ['linear'], SCORE, 0, 6, 100, 10],
]

/* ------------------------------------------------------------------------- *
 * The book
 * ------------------------------------------------------------------------- */

/**
 * Clustering is not a nicety here.
 *
 * At Germany zoom a thousand leads occupy a few hundred pixels, and drawn as
 * dots they are a smear that says "many" and nothing else. A cluster says how
 * many, and — through the colour of its ring — whether there is anything worth
 * calling inside it, which is the actual question being asked at that zoom.
 */
export const CLUSTER_CONFIG = {
  cluster: true,
  clusterRadius: 46,
  // Past this the operator is looking at a street, and a cluster of three is
  // hiding three answers behind one number.
  clusterMaxZoom: 13,
  clusterProperties: {
    // The best lead in the group decides the ring's colour. A max rather than an
    // average, because an average buries the one 92 among forty 20s — and the
    // 92 is the entire reason to zoom in there.
    maxScore: ['max', ['coalesce', ['get', 'score'], 0]],
  },
} as const

/**
 * Every layer below is written as a plain object and cast once on the way out.
 *
 * MapLibre's own types describe paint values as a closed union of literal
 * expression shapes, which an expression assembled from a helper — `scoreRamp`,
 * say — can never satisfy structurally even when it is exactly right. One cast
 * at the boundary is honest about where the checking stops; casting each
 * property would scatter the same admission across forty lines.
 */
const layer = (spec: Record<string, unknown>) => spec as unknown as LayerSpecification

export const clusterLayer = () =>
  layer({
    id: LAYERS.clusters,
    type: 'circle',
    source: SOURCES.leads,
    filter: ['has', 'point_count'],
    paint: {
      /*
       * A dark disc with a coloured rule around it, not a coloured blob.
       * DESIGN.md builds structure out of hairlines rather than fills, and the
       * same instinct is what keeps a cluster from looking like a heat map — it
       * reads as a container holding a count, which is what it is.
       */
      'circle-color': MAP_COLORS.ground,
      'circle-opacity': 0.88,
      'circle-stroke-color': scoreRamp(['get', 'maxScore']),
      'circle-stroke-width': 1,
      'circle-radius': ['step', ['get', 'point_count'], 10, 25, 13, 100, 17, 500, 22],
    },
  })

export const clusterCountLayer = () =>
  layer({
    id: LAYERS.clusterCount,
    type: 'symbol',
    source: SOURCES.leads,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['step', ['get', 'point_count'], 10, 100, 11],
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': MAP_COLORS.ink,
      'text-halo-color': MAP_COLORS.ground,
      'text-halo-width': 1,
    },
  })

export const leadLayer = () =>
  layer({
    id: LAYERS.leads,
    type: 'circle',
    source: SOURCES.leads,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': scoreRamp(SCORE),
      /*
       * A lead the audit has not reached yet is drawn hollow rather than grey.
       *
       * Grey is already the bottom of the score ramp and means "measured, and
       * found to be worth little". An unscored lead has not been measured at
       * all, and colouring it as if it had would be the map telling a small lie
       * about every lead saved in the last ten minutes.
       */
      'circle-opacity': ['case', ['==', ['get', 'score'], null], 0.12, 0.92],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'score'], null],
        MAP_COLORS.inkFaint,
        MAP_COLORS.ground,
      ],
      'circle-stroke-width': 1,
      'circle-radius': DOT_RADIUS,
    },
  })

/* ------------------------------------------------------------------------- *
 * The feed
 * ------------------------------------------------------------------------- */

export const resultLayer = () =>
  layer({
    id: LAYERS.results,
    type: 'circle',
    source: SOURCES.results,
    paint: {
      'circle-color': MAP_COLORS.live,
      // Already in the book means already answered. It stays on the map — hiding
      // it would make the search look like it found fewer businesses than it
      // did — but it recedes, because it is not the opportunity.
      'circle-opacity': ['case', ['get', 'inBook'], 0.35, 0.95],
      // The one place amber touches a green dot: a ticked result is a decision
      // taken, and a decision is the book reaching for it.
      'circle-stroke-color': ['case', ['get', 'selected'], MAP_COLORS.signal, MAP_COLORS.ground],
      'circle-stroke-width': ['case', ['get', 'selected'], 2, 1],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 6, 18, 9],
    },
  })

/* ------------------------------------------------------------------------- *
 * The ring
 * ------------------------------------------------------------------------- */

/**
 * The search area, in `live` green.
 *
 * Green because the ring belongs to the search rather than to the book: it
 * describes an area about to be bought from Google, and everything that comes
 * back inside it will be transient. Dashed, because until Search is pressed it
 * is a proposal.
 */
export const ringFillLayer = () =>
  layer({
    id: LAYERS.ringFill,
    type: 'fill',
    source: SOURCES.ring,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': MAP_COLORS.live, 'fill-opacity': 0.05 },
  })

export const ringLineLayer = () =>
  layer({
    id: LAYERS.ringLine,
    type: 'line',
    source: SOURCES.ring,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'line-color': MAP_COLORS.live,
      'line-width': 1,
      'line-dasharray': [3, 3],
    },
  })

/**
 * The grab handle: the same ring, drawn wide and invisible.
 *
 * A 1px line cannot be hit with a mouse and certainly not with a thumb. This is
 * the hit area, and it is a layer rather than a cursor trick so MapLibre's own
 * feature query answers "did that press land on the ring" for free.
 */
export const ringGrabLayer = () =>
  layer({
    id: LAYERS.ringGrab,
    type: 'line',
    source: SOURCES.ring,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'line-color': MAP_COLORS.live, 'line-opacity': 0, 'line-width': 18 },
  })

export const ringCenterLayer = () =>
  layer({
    id: LAYERS.ringCenter,
    type: 'circle',
    source: SOURCES.ring,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': MAP_COLORS.live,
      'circle-radius': 4,
      'circle-stroke-color': MAP_COLORS.ground,
      'circle-stroke-width': 1.5,
    },
  })

/* ------------------------------------------------------------------------- *
 * The focus mark
 * ------------------------------------------------------------------------- */

/**
 * A ring around whatever the side panel is currently showing.
 *
 * Its own source rather than a flag on the point, and that is a performance
 * decision with a visible consequence: the lead source is clustered, and
 * rewriting it to mark one feature would rebuild the whole cluster index on
 * every click — two thousand points re-indexed to draw one circle, with the
 * clusters visibly flickering as they were rebuilt.
 */
export const focusLayer = () =>
  layer({
    id: LAYERS.focus,
    type: 'circle',
    source: SOURCES.focus,
    paint: {
      'circle-color': MAP_COLORS.signal,
      'circle-opacity': 0,
      'circle-stroke-color': MAP_COLORS.signal,
      'circle-stroke-width': 1.5,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 14, 12, 18, 16],
    },
  })

/* ------------------------------------------------------------------------- *
 * Payloads
 * ------------------------------------------------------------------------- */

export function leadsToGeoJson(points: LeadPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
      properties: {
        id: point.id,
        name: point.name,
        score: point.score,
        status: point.status,
        // Arrays survive a round trip through the cluster worker as JSON, so
        // they are joined here and split on the far side. One string is also
        // one property to serialise for two thousand features.
        auditFlags: point.auditFlags.join(','),
      },
    })),
  }
}

export function resultsToGeoJson(
  rows: SearchRow[],
  selected: Set<string>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    // Google does not always give a coordinate, and a business with none has no
    // place on a map. It is still in the table below; it simply cannot be drawn.
    features: rows
      .filter((row) => row.lat !== null && row.lng !== null)
      .map((row) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng!, row.lat!] },
        properties: {
          id: row.providerPlaceId,
          name: row.name ?? '',
          selected: selected.has(row.providerPlaceId),
          inBook: Boolean(row.savedLeadId),
        },
      })),
  }
}

export const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}
