import type { StyleSpecification } from 'maplibre-gl'

import { MAP_COLORS } from '@/lib/map/palette'

/*
 * The basemap, authored rather than borrowed.
 *
 * Every off-the-shelf style is built for a map that is the point of its page —
 * a bright field, named roads, coloured landuse, points of interest. This one is
 * underneath something: the leads are the only thing on this screen allowed to
 * glow, and a basemap that competes with them has failed at its job even if it
 * is beautiful. So it is drawn from DESIGN.md's own tokens — `ground` for the
 * field, `rule` for the lines, `ink-dim` for the few labels — and holds exactly
 * the roads and borders it takes to know where you are.
 *
 * THE TILES ARE FREE, AND THAT IS A REQUIREMENT RATHER THAN A SAVING.
 * `monthly_ceiling_usd` is 0 by default and the whole product is arranged around
 * never quietly spending. The Google Maps JavaScript API bills per map load, so
 * a map left open on a second monitor would be the first invoice this project
 * ever produced — and it would be produced by looking, not by asking for
 * anything. OpenFreeMap serves the planet as OpenMapTiles-schema vector tiles
 * with no key, no account and no quota, which is the only shape of map that can
 * sit inside a $0 ceiling honestly.
 *
 * Attribution is not optional and is not hardcoded: the source's own TileJSON
 * carries it and MapLibre's attribution control renders whatever it says, so the
 * credit stays correct if the provider's terms change.
 */

/** OpenFreeMap. TileJSON, so the tile URLs and attribution come from the source. */
const TILES_URL = 'https://tiles.openfreemap.org/planet'

/**
 * Glyphs for the labels.
 *
 * Noto Sans rather than Archivo, and that is a constraint rather than a choice:
 * label glyphs are rasterised server-side into SDF atlases per fontstack, so a
 * map may only use faces the tile host has built. Noto Sans is the neutral
 * grotesk of the two the host offers, which keeps the handful of place names on
 * the map from reading as a second voice.
 */
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

const SOURCE = 'openmaptiles'

/** German first, since the book is German. Falls back to whatever the tile has. */
const LABEL: unknown[] = ['coalesce', ['get', 'name:de'], ['get', 'name']]

/**
 * Germany, in one viewport.
 *
 * The opening question of this surface is "where is my book", and the book is
 * German. Flensburg to Oberstdorf at a zoom that fits on a laptop.
 */
export const GERMANY_VIEW = { center: [10.45, 51.16] as [number, number], zoom: 5.1 }

export function basemapStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Lead Engine — ground',
    glyphs: GLYPHS_URL,
    sources: {
      [SOURCE]: { type: 'vector', url: TILES_URL },
    },
    layers: [
      /* The field itself. Identical to the page behind it, so the map does not
         announce its own edges — the leads do. */
      { id: 'ground', type: 'background', paint: { 'background-color': MAP_COLORS.ground } },

      /*
       * Water one step up, exactly as `panel` is one step up from `ground`
       * everywhere else. On a dark field a coastline is the single most useful
       * orientation cue there is, and this is the whole of it: no blue, no
       * gradient, just the same tonal step the rest of the product uses.
       */
      {
        id: 'water',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': MAP_COLORS.panel },
      },
      {
        id: 'water-edge',
        type: 'line',
        source: SOURCE,
        'source-layer': 'water',
        minzoom: 6,
        paint: {
          'line-color': MAP_COLORS.rule,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 0.8],
        },
      },
      {
        id: 'waterway',
        type: 'line',
        source: SOURCE,
        'source-layer': 'waterway',
        minzoom: 8,
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: {
          'line-color': MAP_COLORS.rule,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 1.4],
        },
      },

      /*
       * Buildings, and only where a city would otherwise be a void.
       *
       * Below z15 they are noise; above it their absence is disorienting when
       * you have zoomed to a street to see which side of it a lead is on.
       */
      {
        id: 'building',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-color': MAP_COLORS.raise,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16.5, 0.7],
        },
      },

      /*
       * Roads, in three bands, each arriving at the zoom where it starts
       * carrying information. At Germany zoom the country is its motorways,
       * which is genuinely how a person navigates a national view; the rest
       * would be a grey wash.
       */
      {
        id: 'road-motorway',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 4,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: {
          'line-color': MAP_COLORS.ruleStrong,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 10, 1.2, 16, 3],
        },
      },
      {
        id: 'road-primary',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 8,
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]],
        paint: {
          'line-color': MAP_COLORS.rule,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 14, 1.6, 17, 3],
        },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 12,
        filter: [
          'in',
          ['get', 'class'],
          ['literal', ['tertiary', 'minor', 'service', 'living_street']],
        ],
        paint: {
          'line-color': MAP_COLORS.rule,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 16, 1.2, 18, 2.4],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 14, 1],
        },
      },

      /*
       * Borders. A country edge is `rule-strong` and solid — it is structure;
       * a state edge is `rule` and dashed — it is a hint. Neither is ever
       * brighter than a road, because a border is not somewhere you can go.
       */
      {
        id: 'boundary-state',
        type: 'line',
        source: SOURCE,
        'source-layer': 'boundary',
        minzoom: 4,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: {
          'line-color': MAP_COLORS.rule,
          'line-width': 0.8,
          'line-dasharray': [3, 3],
        },
      },
      {
        id: 'boundary-country',
        type: 'line',
        source: SOURCE,
        'source-layer': 'boundary',
        filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: {
          'line-color': MAP_COLORS.ruleStrong,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.2],
        },
      },

      /*
       * Labels. `ink-dim` for what you steer by, `ink-faint` for the rest —
       * the same two-step the tables use for primary and secondary text, and
       * the reason a map full of names never shouts.
       *
       * Every one carries a `ground` halo. That is not decoration: SDF text on
       * a dark field with roads under it is unreadable without one, and the
       * halo is the field's own colour rather than a glow.
       */
      {
        id: 'label-country',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'place',
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': LABEL,
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 6, 11],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.12,
          'text-max-width': 8,
        },
        paint: {
          'text-color': MAP_COLORS.inkFaint,
          'text-halo-color': MAP_COLORS.ground,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'label-city',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'place',
        minzoom: 4,
        filter: ['in', ['get', 'class'], ['literal', ['city']]],
        layout: {
          'text-field': LABEL,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 13],
          'text-max-width': 9,
          // Big places first when two names collide, which is what the rank
          // field is for. Without it the tile's own order decides, and a
          // village can push Stuttgart off a national view.
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        },
        paint: {
          'text-color': MAP_COLORS.inkDim,
          'text-halo-color': MAP_COLORS.ground,
          'text-halo-width': 1.4,
        },
      },
      {
        id: 'label-town',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'place',
        minzoom: 8,
        filter: ['in', ['get', 'class'], ['literal', ['town', 'village', 'suburb']]],
        layout: {
          'text-field': LABEL,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 11],
          'text-max-width': 9,
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        },
        paint: {
          'text-color': MAP_COLORS.inkFaint,
          'text-halo-color': MAP_COLORS.ground,
          'text-halo-width': 1.4,
        },
      },
      /*
       * Street names, and only from the zoom at which the operator is looking at
       * one street rather than at a city. This is the last label the map adds,
       * because it is the first one that would turn the ground into a document.
       */
      {
        id: 'label-street',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'transportation_name',
        minzoom: 15,
        layout: {
          'text-field': LABEL,
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'symbol-placement': 'line',
          'text-max-angle': 30,
        },
        paint: {
          'text-color': MAP_COLORS.inkFaint,
          'text-halo-color': MAP_COLORS.ground,
          'text-halo-width': 1.4,
        },
      },
    ],
  } as StyleSpecification
}
