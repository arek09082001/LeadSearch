import 'server-only'

import {
  ProviderError,
  type CostEvent,
  type DetailsResult,
  type LeadProvider,
  type ProviderContext,
  type ProviderPlace,
  type ResolvedLocation,
  type SearchEstimate,
  type SearchPage,
  type SearchQuery,
} from '@/lib/providers/types'
import {
  DETAILS_FIELD_MASK,
  DETAILS_TIER,
  GEOCODING_SKU,
  SEARCH_FIELD_MASK,
  SEARCH_TIER,
  buildRateCard,
  skuId,
  skuLabel,
  unitPriceUsd,
} from '@/lib/providers/google-places/skus'

/*
 * Google Places API (New) — the discovery provider.
 *
 * Endpoint choice is decided by what the operator gave us, not by a setting:
 *
 *   text present            -> places:searchText, biased to the circle if we
 *                              have one. Paginates to 60 results.
 *   category + circle only  -> places:searchNearby. Returns 20, has no
 *                              nextPageToken, and is the only one of the two
 *                              that can answer "everything of this type here"
 *                              with no words involved.
 *
 * Both are billed identically, so this is purely about which one can answer the
 * question — never about which is cheaper.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1'
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

/** Google's own cap. Asking for more silently returns 60. */
const MAX_RESULTS_HARD_CAP = 60
/** Google's per-page maximum. Fewer pages means fewer billable requests. */
const PAGE_SIZE = 20

/**
 * The same fields, minus the one Nearby Search does not have.
 *
 * `nextPageToken` belongs to the Text Search response; Nearby Search answers in
 * a single page and never defines it. Asking an endpoint for a field it does not
 * have is not ignored — Google refuses the entire request with HTTP 400,
 * "Request contains an invalid argument", naming nothing. That is what the map's
 * category-only search met the first time anything in this product reached this
 * endpoint at all: every search before it had text in it and took the other
 * branch, so the mask had never been sent here.
 *
 * The billing tier stays `SEARCH_TIER`, computed from the full text mask. It is
 * the higher of the two, and a spend guard that quotes high is the only kind
 * worth having.
 */
const NEARBY_FIELD_MASK = SEARCH_FIELD_MASK.filter((field) => field !== 'nextPageToken')

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    throw new ProviderError(
      'search',
      'Missing GOOGLE_PLACES_API_KEY. Add it to .env.local — see .env.example.',
    )
  }
  return key
}

/** One request, priced at list. The ledger decides what is actually charged. */
function costEvent(
  endpoint: 'text_search' | 'nearby_search' | 'place_details',
  tier: typeof SEARCH_TIER,
  units = 1,
): CostEvent {
  const price = unitPriceUsd(endpoint, tier)
  return {
    sku: skuId(endpoint, tier),
    label: skuLabel(endpoint, tier),
    units,
    unitPriceUsd: price,
    listAmountUsd: price * units,
  }
}

/**
 * Ask permission, spend, then record — in that order, and record even when the
 * request throws.
 *
 * Google bills a request that returned 500 the same as one that returned data,
 * so a ledger that only counted successes would drift below the real invoice.
 * The one exception is a refusal from `authorizeSpend`: nothing was sent, so
 * nothing is recorded.
 */
async function billed<T>(ctx: ProviderContext | undefined, event: CostEvent, run: () => Promise<T>) {
  await ctx?.authorizeSpend?.(event)
  try {
    return await run()
  } finally {
    await ctx?.recordSpend?.(event)
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  fieldMask: readonly string[],
  stage: ProviderError['stage'],
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    // Never let the framework serve a cached copy of a call we paid for, and
    // never let it cache one we are about to pay for again.
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': fieldMask.join(','),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new ProviderError(stage, await googleErrorMessage(res), res.status)
  }
  return (await res.json()) as T
}

/** Google returns a structured error body; surfacing its message beats "500". */
async function googleErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } }
    const message = body.error?.message
    if (message) return `Google Places: ${message} (HTTP ${res.status})`
  } catch {
    // Fall through to the status line.
  }
  return `Google Places returned HTTP ${res.status}.`
}

/* ------------------------------------------------------------------------- *
 * Response shapes — only the parts we read.
 * ------------------------------------------------------------------------- */

interface GooglePlace {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  primaryType?: string
  types?: string[]
  googleMapsUri?: string
}

interface SearchResponse {
  places?: GooglePlace[]
  nextPageToken?: string
}

function normalize(place: GooglePlace): ProviderPlace {
  return {
    providerPlaceId: place.id ?? '',
    name: place.displayName?.text ?? null,
    formattedAddress: place.formattedAddress ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null,
    // Absent means Google reports no website. Our mask always asks for it, so
    // this is a fact about the business, not about the request.
    website: place.websiteUri ?? null,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    businessStatus: place.businessStatus ?? null,
    primaryType: place.primaryType ?? null,
    types: place.types ?? [],
    mapsUri: place.googleMapsUri ?? null,
    raw: place,
  }
}

/* ------------------------------------------------------------------------- *
 * The provider
 * ------------------------------------------------------------------------- */

export class GooglePlacesProvider implements LeadProvider {
  readonly id = 'google_places'
  readonly label = 'Google Places'
  readonly rateCard = buildRateCard()

  estimateSearch(query: SearchQuery): SearchEstimate {
    const wanted = Math.min(query.maxResults ?? MAX_RESULTS_HARD_CAP, MAX_RESULTS_HARD_CAP)
    // Nearby Search cannot paginate, so its worst case is always one request.
    const maxRequests = this.#usesNearby(query) ? 1 : Math.ceil(wanted / PAGE_SIZE)
    const endpoint = this.#usesNearby(query) ? 'nearby_search' : 'text_search'

    return {
      maxRequests,
      maxCostUsd: maxRequests * unitPriceUsd(endpoint, SEARCH_TIER),
      sku: skuId(endpoint, SEARCH_TIER),
      label: skuLabel(endpoint, SEARCH_TIER),
    }
  }

  /**
   * Resolve typed location text to a point, so `radiusM` can mean something.
   *
   * Kept separate from `search()` and optional on the interface because it is a
   * distinct billable event with a distinct cache lifetime: a town centre does
   * not move, while the businesses in it do. The caller caches the answer; this
   * method only knows how to fetch it.
   */
  async resolveLocation(text: string, ctx?: ProviderContext): Promise<ResolvedLocation | null> {
    const event: CostEvent = {
      sku: GEOCODING_SKU,
      label: this.rateCard[GEOCODING_SKU].label,
      units: 1,
      unitPriceUsd: this.rateCard[GEOCODING_SKU].unitPriceUsd,
      listAmountUsd: this.rateCard[GEOCODING_SKU].unitPriceUsd,
    }

    return billed(ctx, event, async () => {
      const url = new URL(GEOCODE_URL)
      url.searchParams.set('address', text)
      url.searchParams.set('key', apiKey())

      const res = await fetch(url, { cache: 'no-store', signal: ctx?.signal })
      if (!res.ok) {
        throw new ProviderError('geocode', `Geocoding returned HTTP ${res.status}.`, res.status)
      }

      const body = (await res.json()) as {
        status?: string
        error_message?: string
        results?: { formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }[]
      }

      if (body.status === 'ZERO_RESULTS') return null
      if (body.status !== 'OK') {
        throw new ProviderError(
          'geocode',
          body.error_message ?? `Geocoding failed: ${body.status ?? 'unknown status'}.`,
        )
      }

      const top = body.results?.[0]
      const point = top?.geometry?.location
      if (!point) return null

      return { lat: point.lat, lng: point.lng, formattedAddress: top?.formatted_address ?? text }
    })
  }

  async *search(
    query: SearchQuery,
    ctx?: ProviderContext,
  ): AsyncGenerator<SearchPage, void, void> {
    const wanted = Math.min(query.maxResults ?? MAX_RESULTS_HARD_CAP, MAX_RESULTS_HARD_CAP)

    if (this.#usesNearby(query)) {
      yield await this.#nearbyPage(query, wanted, ctx)
      return
    }

    if (!query.query.trim()) {
      throw new ProviderError(
        'search',
        'A text query is required unless a category, location and radius are all supplied.',
      )
    }

    /*
     * Dedupe inside the search as well as across it. Google's paginated result
     * sets are not guaranteed disjoint — the same place can appear on two pages
     * — and a repeat here would become a duplicate row on screen and a wasted
     * second look.
     */
    const seen = new Set<string>()
    let pageToken: string | undefined
    let pageIndex = 0
    let delivered = 0

    while (delivered < wanted) {
      const remaining = wanted - delivered
      const event = costEvent('text_search', SEARCH_TIER)

      /*
       * The guard runs before the request, so a refusal on page 2 leaves the 20
       * rows from page 1 already yielded and consumed. The error propagates
       * untouched — the caller is the one that knows those earlier rows are
       * still good and can say why the feed stopped.
       */
      const body = await billed(ctx, event, () =>
        postJson<SearchResponse>(
          `${PLACES_BASE}/places:searchText`,
          this.#textSearchBody(query, Math.min(PAGE_SIZE, remaining), pageToken),
          SEARCH_FIELD_MASK,
          'search',
          ctx?.signal,
        ),
      )

      const places: ProviderPlace[] = []
      for (const raw of body.places ?? []) {
        const place = normalize(raw)
        if (!place.providerPlaceId || seen.has(place.providerPlaceId)) continue
        seen.add(place.providerPlaceId)
        places.push(place)
      }

      delivered += places.length
      pageToken = body.nextPageToken
      const hasMore = Boolean(pageToken) && delivered < wanted

      yield { pageIndex, places, cost: [event], hasMore }

      pageIndex += 1
      if (!hasMore) return
    }
  }

  async getDetails(providerPlaceId: string, ctx?: ProviderContext): Promise<DetailsResult> {
    const event = costEvent('place_details', DETAILS_TIER)

    const place = await billed(ctx, event, async () => {
      const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(providerPlaceId)}`, {
        cache: 'no-store',
        signal: ctx?.signal,
        headers: {
          'X-Goog-Api-Key': apiKey(),
          'X-Goog-FieldMask': DETAILS_FIELD_MASK.join(','),
        },
      })
      if (!res.ok) {
        throw new ProviderError('details', await googleErrorMessage(res), res.status)
      }
      return (await res.json()) as GooglePlace
    })

    return { place: normalize(place), cost: [event] }
  }

  /* ----------------------------------------------------------------------- */

  /** Nearby Search is only reachable with no words and a real circle to search in. */
  #usesNearby(query: SearchQuery): boolean {
    return (
      !query.query.trim() &&
      Boolean(query.category) &&
      Boolean(query.center) &&
      Boolean(query.radiusM)
    )
  }

  #textSearchBody(query: SearchQuery, pageSize: number, pageToken?: string) {
    /*
     * Google requires every parameter to be repeated unchanged alongside a
     * pageToken, so the body is rebuilt in full for each page rather than
     * reduced to just the token.
     */
    const body: Record<string, unknown> = {
      // Folding the location into the text is what makes "Zahnarzt Heilbronn"
      // work with no geocoding call at all. The circle below only narrows it.
      textQuery: [query.query.trim(), query.location?.trim()].filter(Boolean).join(' '),
      pageSize,
      languageCode: query.languageCode ?? 'de',
      regionCode: query.regionCode ?? 'DE',
    }

    if (query.category) body.includedType = query.category
    if (query.center && query.radiusM) {
      body.locationBias = {
        circle: {
          center: { latitude: query.center.lat, longitude: query.center.lng },
          radius: query.radiusM,
        },
      }
    }
    if (pageToken) body.pageToken = pageToken

    return body
  }

  async #nearbyPage(
    query: SearchQuery,
    wanted: number,
    ctx?: ProviderContext,
  ): Promise<SearchPage> {
    const event = costEvent('nearby_search', SEARCH_TIER)

    const body = await billed(ctx, event, () =>
      postJson<SearchResponse>(
        `${PLACES_BASE}/places:searchNearby`,
        {
          includedTypes: [query.category],
          maxResultCount: Math.min(PAGE_SIZE, wanted),
          languageCode: query.languageCode ?? 'de',
          regionCode: query.regionCode ?? 'DE',
          locationRestriction: {
            circle: {
              center: { latitude: query.center!.lat, longitude: query.center!.lng },
              radius: query.radiusM,
            },
          },
        },
        NEARBY_FIELD_MASK,
        'search',
        ctx?.signal,
      ),
    )

    const seen = new Set<string>()
    const places: ProviderPlace[] = []
    for (const raw of body.places ?? []) {
      const place = normalize(raw)
      if (!place.providerPlaceId || seen.has(place.providerPlaceId)) continue
      seen.add(place.providerPlaceId)
      places.push(place)
    }

    // Nearby Search issues no nextPageToken; one request is the whole result set.
    return { pageIndex: 0, places, cost: [event], hasMore: false }
  }
}
