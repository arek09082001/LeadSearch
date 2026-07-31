import { auth } from '@/auth'
import { runSearch } from '@/lib/search/run'
import type { SearchEvent, SearchInput } from '@/lib/search/types'

/*
 * Discovery, as a stream.
 *
 * NDJSON — one JSON object per line — rather than JSON or SSE. A 60-result
 * search is three sequential Google round trips, and the operator should be
 * reading page one while page three is still in flight. SSE would work too, but
 * it buys reconnection semantics we do not want: this stream costs money to
 * produce, so a silent automatic retry is the last thing it should do.
 *
 * POST, not GET, for the same reason: a search is a billable side effect and
 * must never be prefetched, retried by a proxy, or replayed from history.
 */

// node:crypto in the hash, `server-only` throughout: this route is not edge-safe.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_QUERY_LENGTH = 200
const MAX_RADIUS_M = 50_000

function parseInput(body: unknown): SearchInput | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Expected a JSON object.' }
  }
  const raw = body as Record<string, unknown>

  const query = typeof raw.query === 'string' ? raw.query.trim() : ''
  const location = typeof raw.location === 'string' ? raw.location.trim() : undefined
  const category = typeof raw.category === 'string' && raw.category ? raw.category : undefined

  if (!query && !category) {
    return { error: 'Enter a query, or pick a category to search by type.' }
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return { error: `Query is too long (max ${MAX_QUERY_LENGTH} characters).` }
  }

  const radiusM = Number(raw.radiusM)
  if (raw.radiusM != null && (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > MAX_RADIUS_M)) {
    return { error: `Radius must be between 1 and ${MAX_RADIUS_M} metres.` }
  }

  const center = parseCenter(raw.center)
  if (center && 'error' in center) return center

  /*
   * A centre with no radius is refused rather than accepted and ignored.
   *
   * The search form already drops a radius that has no location to centre on,
   * saying so in a disabled control instead of sending a number nothing will
   * read. This is the same rule from the other end: a point the provider would
   * never look at is a click the operator made and the search silently threw
   * away — and he would have paid for the unbiased search that came back.
   */
  if (center && !(raw.radiusM != null && Number.isFinite(radiusM) && radiusM > 0)) {
    return { error: 'A point needs a radius to search within.' }
  }

  const maxResults = Number(raw.maxResults)

  return {
    query,
    location: location || undefined,
    center: center ?? undefined,
    category,
    radiusM: raw.radiusM != null ? radiusM : undefined,
    maxResults: Number.isFinite(maxResults) && maxResults > 0 ? maxResults : undefined,
    refresh: raw.refresh === true,
  }
}

/**
 * A centre handed in instead of typed — a point clicked on the map.
 *
 * Numbers, strictly: `Number("")` and `Number(null)` are both 0, which is a
 * real coordinate in the Gulf of Guinea, and a search centred there because a
 * field arrived empty is a search bought for nothing.
 */
function parseCenter(
  value: unknown,
): { lat: number; lng: number } | { error: string } | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object') return { error: 'center must be an object with lat and lng.' }

  const { lat, lng } = value as { lat?: unknown; lng?: unknown }
  const ok = (n: unknown, limit: number) =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit

  if (!ok(lat, 90) || !ok(lng, 180)) {
    return { error: 'center must be a point on Earth: lat between -90 and 90, lng between -180 and 180.' }
  }
  return { lat: lat as number, lng: lng as number }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const input = parseInput(body)
  if ('error' in input) {
    return Response.json({ error: input.error }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SearchEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))

      try {
        for await (const event of runSearch(input, request.signal)) {
          send(event)
        }
      } catch (error) {
        /*
         * The generator already converts every expected failure into an event,
         * so reaching here means something genuinely unhandled. It still has to
         * arrive as an event: the response is already committed with a 200, and
         * a stream that just stops is indistinguishable from a dropped
         * connection.
         */
        if (!request.signal.aborted) {
          console.error('[api/search] unhandled failure', error)
          send({
            type: 'error',
            message: error instanceof Error ? error.message : 'The search failed unexpectedly.',
          })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // Tells nginx-shaped proxies not to buffer, which would defeat the point.
      'X-Accel-Buffering': 'no',
    },
  })
}
