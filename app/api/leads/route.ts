import { after } from 'next/server'

import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { runEnrichment } from '@/lib/enrichment/run'
import { parseFilters } from '@/lib/leads/filters'
import { queryLeads, saveLeads } from '@/lib/leads/repository'
import { LIMITS, type SaveCandidate, type SaveRequest } from '@/lib/leads/types'

/*
 * The save route. This is the only door into the leads library.
 *
 * POST rather than PUT because saving is not idempotent in the way that matters
 * to the operator: the second save of the same business refreshes its Google
 * snapshot and re-queues its audit, and both of those are things he asked for
 * by clicking again.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The response returns immediately; this is the budget for the audit pass that
// `after` runs once it has.
export const maxDuration = 60

const MAX_CANDIDATES = 200
/** The library's own ceiling, so the route and the field that feeds it agree. */
const MAX_NOTE_LENGTH = LIMITS.note

function parseCandidate(value: unknown): SaveCandidate | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const googlePlaceId = typeof raw.googlePlaceId === 'string' ? raw.googlePlaceId.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  // The place id is the identity of the row; a candidate without one cannot be
  // deduplicated, refreshed, or matched against a future search.
  if (!googlePlaceId || !name) return null

  const numberOrNull = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? input : null
  const stringOrNull = (input: unknown) =>
    typeof input === 'string' && input.trim() ? input.trim() : null

  return {
    googlePlaceId,
    name,
    formattedAddress: stringOrNull(raw.formattedAddress),
    lat: numberOrNull(raw.lat),
    lng: numberOrNull(raw.lng),
    phone: stringOrNull(raw.phone),
    website: stringOrNull(raw.website),
    rating: numberOrNull(raw.rating),
    userRatingCount: numberOrNull(raw.userRatingCount),
    businessStatus: stringOrNull(raw.businessStatus),
    primaryType: stringOrNull(raw.primaryType),
    types: Array.isArray(raw.types) ? raw.types.filter((t): t is string => typeof t === 'string') : [],
    mapsUri: stringOrNull(raw.mapsUri),
    raw: raw.raw ?? null,
    fetchedAt: stringOrNull(raw.fetchedAt) ?? undefined,
  }
}

export async function POST(request: Request) {
  try {
    await requireSession()
    const body = (await readJson(request)) as Record<string, unknown>

    if (!Array.isArray(body?.candidates)) {
      return Response.json({ error: 'Expected a list of businesses to save.' }, { status: 400 })
    }
    if (body.candidates.length > MAX_CANDIDATES) {
      return Response.json(
        { error: `Too many at once (max ${MAX_CANDIDATES}). Save in smaller batches.` },
        { status: 400 },
      )
    }

    const candidates = body.candidates
      .map(parseCandidate)
      .filter((candidate): candidate is SaveCandidate => candidate !== null)

    if (!candidates.length) {
      return Response.json({ error: 'None of those businesses could be read.' }, { status: 400 })
    }

    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : null

    const payload: SaveRequest = {
      candidates,
      searchId: typeof body.searchId === 'string' ? body.searchId : null,
      listId: typeof body.listId === 'string' && body.listId ? body.listId : null,
      newListName: typeof body.newListName === 'string' ? body.newListName.trim() : null,
      note: note || null,
    }

    const result = await saveLeads(payload)

    /*
     * The audit runs after the response is on the wire. The operator is told
     * what was saved immediately and the auditing happens behind him — which is
     * the whole reason `enrichment_state` is a column he can see rather than a
     * spinner he has to wait on.
     */
    const queued = result.items
      .filter((item) => item.leadId && item.outcome !== 'failed')
      .map((item) => item.leadId!)

    if (queued.length) after(() => runEnrichment(queued))

    return Response.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * The library, as JSON.
 *
 * The page itself is a server component and reads the repository directly, so
 * this exists for the client: it is what the table calls after a bulk action to
 * pick up the new state without a full navigation.
 */
export async function GET(request: Request) {
  try {
    await requireSession()
    const filters = parseFilters(new URL(request.url).searchParams)
    return Response.json(await queryLeads(filters))
  } catch (error) {
    return errorResponse(error)
  }
}
