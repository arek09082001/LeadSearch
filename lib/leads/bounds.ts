import type { LeadBounds } from '@/lib/leads/types'

/*
 * The viewport, as URL parameters.
 *
 * A sibling of lib/leads/filters.ts rather than part of it, for the reason
 * `LeadBounds` is not part of `LeadFilters`: a filter says which leads exist, a
 * box says which part of the world is on screen. The library page never reads
 * one — only the map does, and it reads it over the wire — so this codec speaks
 * `URLSearchParams` alone and does not need the object form the page uses.
 *
 * Four named parameters rather than one comma-joined `bbox`, because the map
 * builds these by hand and so does a curl. `?west=9.1&south=49.1&east=9.3&north=49.2`
 * says which number is which; `?bbox=9.1,49.1,9.3,49.2` requires you to
 * remember an ordering, and the failure when you get it wrong is an empty map
 * rather than an error.
 */

/** Every leaflet-shaped map hands back these four. Nothing here is optional. */
const KEYS = ['north', 'south', 'east', 'west'] as const

function readNumber(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Fold a longitude back onto the globe.
 *
 * A value already on it is returned untouched rather than run through the
 * arithmetic, which is not just a shortcut: `((9.1 + 180) % 360 + 360) % 360 -
 * 180` is 9.100000000000023, and every ordinary viewport would come back with
 * float noise on both edges for no reason at all.
 */
function wrapLng(value: number): number {
  if (value >= -180 && value <= 180) return value
  return (((value + 180) % 360) + 360) % 360 - 180
}

function clampLat(value: number): number {
  return Math.min(90, Math.max(-90, value))
}

/**
 * Read a bounding box, or say which part of it was missing.
 *
 * Shaped like the search route's own parser — a value or an `{ error }` — so the
 * handler answers 400 with a sentence rather than returning an empty map that
 * looks like a book with nothing in it.
 *
 * Three things are corrected rather than refused, because all three are what a
 * real map hands you rather than what a mistake looks like:
 *
 *   - Latitudes past the poles. Zoom a web map out far enough and it reports a
 *     viewport taller than the planet. Clamped.
 *   - `south` above `north`. Swapped, the same way lib/leads/filters.ts swaps a
 *     score range typed backwards: it is unambiguous what was meant.
 *   - A viewport wider than the world. At low zoom the same map reports west
 *     and east more than 360 degrees apart, which after wrapping would become a
 *     narrow box showing almost nothing. Widened to the whole globe instead.
 *
 * `west` greater than `east` survives all of that untouched: that is a box
 * crossing the antimeridian, and the query knows how to read it.
 */
export function parseBounds(params: URLSearchParams): LeadBounds | { error: string } {
  const missing = KEYS.filter((key) => readNumber(params, key) === null)
  if (missing.length) {
    return {
      error: `A bounding box needs north, south, east and west as numbers. Missing or unreadable: ${missing.join(', ')}.`,
    }
  }

  const north = clampLat(readNumber(params, 'north')!)
  const south = clampLat(readNumber(params, 'south')!)
  const rawWest = readNumber(params, 'west')!
  const rawEast = readNumber(params, 'east')!
  const spansWorld = rawEast - rawWest >= 360

  return {
    north: Math.max(north, south),
    south: Math.min(north, south),
    west: spansWorld ? -180 : wrapLng(rawWest),
    east: spansWorld ? 180 : wrapLng(rawEast),
  }
}

/** The inverse, for the map that builds the request. */
export function boundsToSearchParams(bounds: LeadBounds): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of KEYS) params.set(key, String(bounds[key]))
  return params
}
