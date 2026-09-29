import 'server-only'

import { createHash } from 'node:crypto'

import type { ProviderPlace, ResolvedLocation } from '@/lib/providers/types'
import { createServiceClient } from '@/lib/supabase/server'
import type { SearchInput, SearchRow } from '@/lib/search/types'

/*
 * Everything the search surface reads from or writes to Postgres.
 *
 * The transient/permanent split is enforced here as much as in the schema: this
 * module writes `searches` and `search_results`, and only ever *reads* `leads`.
 * Nothing on the discovery path can create a lead — saving stays an explicit
 * act on a different route.
 */

/**
 * How long an identical search may be answered from its own previous results.
 *
 * Distinct from the 30-day expiry on `search_results`, and deliberately much
 * shorter. The 30 days are a compliance ceiling — the longest Google data may
 * be kept. This is a freshness floor: how long a result set is still worth
 * looking at. A dentist's phone number does not change in a week, so a repeat
 * search inside that window is answered for nothing; past it, the operator is
 * better served by paying again. `refresh: true` overrides it either way.
 */
const REPLAY_WINDOW_HOURS = 24 * 7

/** Collapse the incidental so that "Zahnarzt  Heilbronn" and "zahnarzt heilbronn" are one query. */
function normalizeText(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * A stable fingerprint of the question being asked.
 *
 * Derived only from parameters that change the answer, so cosmetic differences
 * in how the operator typed it still hit the same cache entry. `maxResults` is
 * included because a 60-result search cannot be served from a 20-result one.
 */
export function paramsHash(input: SearchInput, providerId: string): string {
  const canonical = JSON.stringify({
    provider: providerId,
    query: normalizeText(input.query),
    location: normalizeText(input.location),
    radiusM: input.radiusM ?? null,
    category: normalizeText(input.category) || null,
    maxResults: input.maxResults ?? null,
    /*
     * A clicked centre changes the answer, so it changes the fingerprint —
     * otherwise the same words clicked in two towns would replay each other's
     * results, which is the one failure a cache must never have.
     *
     * Present only when there is one, so every search asked before this existed
     * still hashes to what it hashed to. Adding a `center: null` key would have
     * invalidated the whole replay cache on deploy, and a cache emptied by a
     * deploy is a week of searches bought a second time.
     *
     * Rounded to five decimals — a metre — because two clicks meant as the same
     * spot are never the same float, and a fingerprint nothing can ever match
     * twice is not a cache key.
     */
    ...(input.center
      ? { center: [round5(input.center.lat), round5(input.center.lng)] }
      : {}),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

/* ------------------------------------------------------------------------- *
 * Geocode cache
 * ------------------------------------------------------------------------- */

export async function readGeocodeCache(locationText: string): Promise<ResolvedLocation | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('geocode_cache')
    .select('lat, lng, formatted_address')
    .eq('query_norm', normalizeText(locationText))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error || !data) return null
  return {
    lat: Number(data.lat),
    lng: Number(data.lng),
    formattedAddress: data.formatted_address ?? locationText,
  }
}

export async function writeGeocodeCache(
  locationText: string,
  resolved: ResolvedLocation,
  providerId: string,
): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('geocode_cache').upsert(
    {
      query_norm: normalizeText(locationText),
      lat: resolved.lat,
      lng: resolved.lng,
      formatted_address: resolved.formattedAddress,
      provider: providerId,
      // Re-resolving restarts the retention clock rather than inheriting the
      // old row's expiry, which would shorten with every write.
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    },
    { onConflict: 'query_norm' },
  )
}

/* ------------------------------------------------------------------------- *
 * Searches
 * ------------------------------------------------------------------------- */

export interface ReplayableSearch {
  searchId: string
  ranAt: string
  places: ProviderPlace[]
  fetchedAt: string
}

/**
 * The cheapest possible search: the one already paid for.
 *
 * Finds the most recent identical search inside the replay window and returns
 * its results, but only if they are still unexpired — a search whose rows the
 * nightly sweep has deleted is a cache miss, not an empty result set.
 */
export async function findReplayableSearch(hash: string): Promise<ReplayableSearch | null> {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - REPLAY_WINDOW_HOURS * 3600 * 1000).toISOString()

  const { data: search } = await supabase
    .from('searches')
    .select('id, ran_at')
    .eq('params_hash', hash)
    .is('error', null)
    .gte('ran_at', cutoff)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!search) return null

  const { data: rows } = await supabase
    .from('search_results')
    // One unbroken literal on purpose: supabase-js infers the row shape from the
    // literal type of this string, and concatenating it collapses that to `string`.
    .select(
      'google_place_id, result_rank, name, formatted_address, lat, lng, phone, website, rating, user_rating_count, business_status, primary_type, types, google_maps_uri, raw, fetched_at',
    )
    .eq('search_id', search.id)
    .gt('expires_at', new Date().toISOString())
    .order('result_rank', { ascending: true })

  if (!rows?.length) return null

  return {
    searchId: search.id,
    ranAt: search.ran_at,
    fetchedAt: rows[0].fetched_at,
    places: rows.map(
      (row): ProviderPlace => ({
        providerPlaceId: row.google_place_id,
        name: row.name,
        formattedAddress: row.formatted_address,
        lat: row.lat === null ? null : Number(row.lat),
        lng: row.lng === null ? null : Number(row.lng),
        phone: row.phone,
        website: row.website,
        rating: row.rating === null ? null : Number(row.rating),
        userRatingCount: row.user_rating_count,
        businessStatus: row.business_status,
        primaryType: row.primary_type,
        types: row.types ?? [],
        mapsUri: row.google_maps_uri,
        raw: row.raw,
      }),
    ),
  }
}

export async function createSearch(
  input: SearchInput,
  providerId: string,
  hash: string,
  resolved: ResolvedLocation | null,
): Promise<string> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('searches')
    .insert({
      query: input.query.trim(),
      location_text: input.location?.trim() || null,
      location_lat: resolved?.lat ?? null,
      location_lng: resolved?.lng ?? null,
      radius_m: input.radiusM ?? null,
      category: input.category || null,
      provider: providerId,
      params_hash: hash,
      request_params: {
        query: input.query,
        location: input.location ?? null,
        // What was asked, verbatim. `location_lat`/`location_lng` above hold the
        // centre either way; this is the record of which way it got there — a
        // point given, or text resolved.
        center: input.center ?? null,
        radiusM: input.radiusM ?? null,
        category: input.category ?? null,
        maxResults: input.maxResults ?? null,
      },
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not record the search: ${error.message}`)
  return data.id
}

export async function finalizeSearch(
  searchId: string,
  update: { resultCount: number; costUsd: number; error?: string | null },
): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('searches')
    .update({
      result_count: update.resultCount,
      estimated_cost_usd: update.costUsd,
      error: update.error ?? null,
    })
    .eq('id', searchId)
}

/* ------------------------------------------------------------------------- *
 * Results
 * ------------------------------------------------------------------------- */

/**
 * Persist a page of Google-sourced rows.
 *
 * `fetched_at` and `expires_at` are left to their column defaults on purpose:
 * the retention clock starts when the row is written, and nothing in the app
 * gets to set it forward.
 */
export async function persistResults(
  searchId: string,
  places: ProviderPlace[],
  startRank: number,
): Promise<void> {
  if (!places.length) return

  const supabase = createServiceClient()
  const { error } = await supabase.from('search_results').upsert(
    places.map((place, index) => ({
      search_id: searchId,
      google_place_id: place.providerPlaceId,
      result_rank: startRank + index,
      name: place.name,
      formatted_address: place.formattedAddress,
      lat: place.lat,
      lng: place.lng,
      phone: place.phone,
      website: place.website,
      rating: place.rating,
      user_rating_count: place.userRatingCount,
      business_status: place.businessStatus,
      primary_type: place.primaryType,
      types: place.types,
      google_maps_uri: place.mapsUri,
      raw: place.raw,
    })),
    { onConflict: 'search_id,google_place_id' },
  )

  // Results are already on their way to the screen; losing the cache copy costs
  // a future replay, not this search.
  if (error) {
    console.error('[search] failed to persist results', { searchId, error: error.message })
  }
}

/**
 * Which of these places are already in the book.
 *
 * A read against `leads` and nothing more. This is the join the schema was
 * shaped for: the transient side holds no pointer into the permanent side, so
 * "already saved?" is answered by place id at query time.
 */
export async function markSavedLeads(
  places: ProviderPlace[],
  /** When this Google data was fetched. Passed in, because replayed rows are older than now. */
  fetchedAt: string = new Date().toISOString(),
): Promise<SearchRow[]> {
  if (!places.length) return []

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('leads')
    .select('id, google_place_id, status')
    .in(
      'google_place_id',
      places.map((place) => place.providerPlaceId),
    )

  const saved = new Map((data ?? []).map((lead) => [lead.google_place_id, lead]))

  return places.map((place) => {
    const lead = saved.get(place.providerPlaceId)
    return {
      ...place,
      savedLeadId: lead?.id ?? null,
      savedStatus: lead?.status ?? null,
      fetchedAt,
    }
  })
}
