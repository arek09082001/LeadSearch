import 'server-only'

import { cityFrom, saveLeads } from '@/lib/leads/repository'
import type { SaveCandidate } from '@/lib/leads/types'
import { queueAudit } from '@/lib/mcp/enrich'
import { forgetSkipped, logMcpCall } from '@/lib/mcp/store'
import type { SavedLead } from '@/lib/mcp/vocabulary'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * `save_leads` — the operator overruling the rule.
 *
 * It used to be the whole of saving. Now that `search_places` writes what it
 * decides, this is the appeal: a business the rule threw away that the operator
 * wants anyway. That makes its second job the important one — the place ID
 * comes OUT of `skipped_places`, or the next search would silently reject the
 * same business again and the appeal would have lasted exactly one afternoon.
 *
 * Place IDs and nothing else. The place data is already in `search_results`,
 * paid for by the search that found it and kept for its retention window, so
 * asking the caller to hand back a business it was only ever shown a count of
 * would be asking it to invent one. If the window has closed, that is reported
 * as `notFound` rather than papered over with a fresh Google call: a lead
 * conjured from a second search is not the business the operator meant to
 * rescue, and it would be billed besides.
 */

export interface SaveLeadsInput {
  placeIds: string[]
  /** One note, written onto every lead saved. */
  note?: string
}

export interface SaveLeadsResult {
  saved: SavedLead[]
  /** Place IDs whose cached Google data has expired, or that no search here ever returned. */
  notFound: string[]
  failed: { placeId: string; error: string }[]
  /** How many of these were in `skipped_places` and are not any more. */
  unskipped: number
}

interface CachedPlace {
  google_place_id: string
  name: string | null
  formatted_address: string | null
  lat: number | null
  lng: number | null
  phone: string | null
  website: string | null
  rating: number | null
  user_rating_count: number | null
  business_status: string | null
  primary_type: string | null
  types: string[] | null
  google_maps_uri: string | null
  raw: unknown
  fetched_at: string
}

/*
 * One unbroken literal, for the reason `LIBRARY_COLUMNS` is one: supabase-js
 * infers the row shape from the literal type of this string, and splitting it
 * across lines to be tidy collapses that inference to `string`.
 */
const CACHED_COLUMNS =
  'google_place_id, name, formatted_address, lat, lng, phone, website, rating, user_rating_count, business_status, primary_type, types, google_maps_uri, raw, fetched_at'

/**
 * The freshest surviving copy of each place, from the transient side.
 *
 * A business found by three searches has three rows; the newest wins, and its
 * `fetched_at` travels to `leads.fetched_at` unchanged. A lead saved from a
 * week-old cached result is a week old, and every surface in this product has
 * to be able to say so.
 */
async function readCachedPlaces(placeIds: string[]): Promise<Map<string, CachedPlace>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('search_results')
    .select(CACHED_COLUMNS)
    .in('google_place_id', placeIds)
    .gt('expires_at', new Date().toISOString())
    .order('fetched_at', { ascending: false })

  if (error) throw new Error(`Could not read the cached search results: ${error.message}`)

  const newest = new Map<string, CachedPlace>()
  for (const row of (data ?? []) as CachedPlace[]) {
    if (!newest.has(row.google_place_id)) newest.set(row.google_place_id, row)
  }
  return newest
}

function candidateOf(place: CachedPlace): SaveCandidate {
  return {
    googlePlaceId: place.google_place_id,
    name: place.name ?? place.google_place_id,
    formattedAddress: place.formatted_address,
    lat: place.lat,
    lng: place.lng,
    phone: place.phone,
    website: place.website,
    rating: place.rating === null ? null : Number(place.rating),
    userRatingCount: place.user_rating_count,
    businessStatus: place.business_status,
    primaryType: place.primary_type,
    types: place.types ?? [],
    mapsUri: place.google_maps_uri,
    raw: place.raw,
    fetchedAt: place.fetched_at,
    /*
     * `manual`, always, and not a parameter. A person named this place ID; that
     * IS the lead type, and letting the caller claim `weak_website` here would
     * let an assistant assert a website fault nothing checked.
     */
    leadType: 'manual',
  }
}

export async function saveLeadsByPlaceId(input: SaveLeadsInput): Promise<SaveLeadsResult> {
  const started = Date.now()
  const placeIds = [...new Set(input.placeIds.map((id) => id.trim()).filter(Boolean))]

  if (!placeIds.length) {
    return { saved: [], notFound: [], failed: [], unskipped: 0 }
  }

  const cached = await readCachedPlaces(placeIds)
  const notFound = placeIds.filter((id) => !cached.has(id))
  const candidates = placeIds
    .filter((id) => cached.has(id))
    .map((id) => candidateOf(cached.get(id)!))

  const result = candidates.length
    ? await saveLeads({ candidates, note: input.note?.trim() || null })
    : null

  const failed = (result?.items ?? [])
    .filter((item) => item.outcome === 'failed')
    .map((item) => ({ placeId: item.googlePlaceId, error: item.error ?? 'The insert returned no row.' }))

  const failedIds = new Set(failed.map((entry) => entry.placeId))

  const saved: SavedLead[] = candidates
    .filter((candidate) => !failedIds.has(candidate.googlePlaceId))
    .map((candidate) => ({
      placeId: candidate.googlePlaceId,
      name: candidate.name,
      city: cityFrom(candidate.formattedAddress),
      leadType: 'manual' as const,
      rating: candidate.rating ?? null,
      reviewCount: candidate.userRatingCount ?? null,
      weaknessSignals: [],
    }))

  /*
   * The rejection is cleared only for what actually landed.
   *
   * Clearing it for a failed insert would leave a business that is neither a
   * lead nor a remembered rejection — invisible in the book and re-examined at
   * full price by every future search, which is the worst of both.
   */
  const unskipped = await forgetSkipped(saved.map((lead) => lead.placeId))

  queueAudit(
    (result?.items ?? [])
      .filter((item) => item.leadId && item.outcome !== 'failed')
      .map((item) => item.leadId!),
  )

  await logMcpCall({
    tool: 'save_leads',
    params: input,
    savedCount: saved.length,
    skippedCount: 0,
    placesCalls: 0,
    siteChecks: 0,
    durationMs: Date.now() - started,
    error: notFound.length ? `${notFound.length} place id(s) had no cached result left.` : null,
  })

  return { saved, notFound, failed, unskipped }
}
