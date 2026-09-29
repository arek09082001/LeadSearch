/*
 * The arithmetic a search ring needs, and nothing else.
 *
 * Three functions rather than a geo library: the map draws one circle and
 * measures one drag, and pulling in turf for that would be a megabyte of
 * dependency to do what fifteen lines of trigonometry already do exactly.
 */

/** Mean Earth radius, metres — the IUGG value the haversine convention uses. */
const EARTH_RADIUS_M = 6_371_008.8

const toRad = (degrees: number) => (degrees * Math.PI) / 180
const toDeg = (radians: number) => (radians * 180) / Math.PI

export interface Point {
  lat: number
  lng: number
}

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than the flat approximation, because the drag that sets a
 * radius has to agree with the ring that was drawn from it — and a planar
 * estimate is out by half a percent at German latitudes, which is enough for a
 * 50 km ring to snap visibly when you let go.
 */
export function distanceM(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The point `distance` metres from `origin` on `bearing`.
 *
 * The inverse of the above, and what makes the ring a real circle on the ground
 * rather than an ellipse that happens to look right at one latitude. Web
 * Mercator stretches east–west with latitude, so a ring drawn from a fixed
 * degree offset would be visibly wrong the moment the operator pans north.
 */
function destination(origin: Point, distance: number, bearing: number): [number, number] {
  const delta = distance / EARTH_RADIUS_M
  const theta = toRad(bearing)
  const lat1 = toRad(origin.lat)
  const lng1 = toRad(origin.lng)

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    )

  return [toDeg(lng2), toDeg(lat2)]
}

/** A circle on the ground, as a GeoJSON ring. 72 steps is smooth at any zoom. */
export function circlePolygon(
  center: Point,
  radiusM: number,
  steps = 72,
): GeoJSON.Polygon {
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destination(center, radiusM, (i * 360) / steps))
  }
  // GeoJSON wants the ring closed exactly; the loop above lands on the first
  // point again but through arithmetic, which can leave float noise.
  ring[steps] = ring[0]
  return { type: 'Polygon', coordinates: [ring] }
}

/**
 * What the search route will accept, restated where the controls are built.
 *
 * The ceiling is Google's own cap on a nearby search and the route refuses past
 * it; the floor is this product's, and it exists because a 50 m ring is a drag
 * that missed rather than a search anybody meant.
 */
export const RADIUS_LIMITS = { min: 250, max: 50_000 } as const

export function clampRadius(metres: number): number {
  return Math.round(Math.min(RADIUS_LIMITS.max, Math.max(RADIUS_LIMITS.min, metres)))
}

/** A radius as a person says it: metres under a kilometre, kilometres above. */
export function formatRadius(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`
  const km = metres / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

/** A clicked point, written the way lib/search/run.ts writes a resolved one. */
export function formatPoint(point: Point): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}
