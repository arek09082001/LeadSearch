/*
 * What a Google Places request costs, derived from the fields it asks for.
 *
 * The Places API (New) does not price an endpoint — it prices a *field mask*.
 * Every response field belongs to a tier, and a request is billed at the
 * highest tier any field in its mask touches. Ask for one extra field and the
 * whole call jumps a price band.
 *
 * That is why the tier is COMPUTED here from the mask rather than written down
 * next to each call site. A hand-labelled constant would quietly become a lie
 * the first time someone adds a field to a mask; `tierForFields()` cannot.
 *
 * The consequence that shapes this product: `websiteUri`, `rating` and
 * `userRatingCount` are all Enterprise fields, and they are precisely the three
 * signals the search table exists to show. Discovery therefore bills at Text
 * Search Enterprise — $35/1000 with only 1,000 free calls a month — and no
 * amount of mask trimming avoids it. Trimming still matters for Place Details,
 * where a refresh that only needs an address can stay two bands cheaper.
 *
 * Rates and allowances below are the published global list prices, read
 * 2026-07-30 from:
 *   https://developers.google.com/maps/billing-and-pricing/pricing
 *   https://developers.google.com/maps/documentation/places/web-service/data-fields
 * They are list prices only. The ledger, not this file, decides what was
 * actually charged after the monthly free allowance is applied.
 */

/** Price bands, cheapest first. Order is load-bearing — `tierForFields` takes the max. */
export const TIERS = ['ids_only', 'pro', 'enterprise', 'enterprise_atmosphere'] as const
export type Tier = (typeof TIERS)[number]

const TIER_RANK: Record<Tier, number> = {
  ids_only: 0,
  pro: 1,
  enterprise: 2,
  enterprise_atmosphere: 3,
}

/*
 * Field → tier. Leaf names only: the `places.` prefix that Text Search and
 * Nearby Search require is stripped before lookup, so one table serves all
 * three endpoints (their groupings are identical; only the price differs).
 */

const IDS_ONLY = new Set([
  'attributions',
  'id',
  'name',
  'movedPlace',
  'movedPlaceId',
  'nextPageToken',
])

/*
 * Place Details splits this band into "Essentials" (address-shaped fields) and
 * "Pro" (identity-shaped fields); Text Search does not, and prices both as Pro.
 * They are merged here and priced as Pro throughout, which over-states the cost
 * of an address-only Place Details call and under-states nothing. Every mask
 * this codebase builds includes `displayName`, which is Pro anyway, so the
 * approximation never actually fires.
 */
const PRO = new Set([
  'addressComponents',
  'addressDescriptor',
  'adrFormatAddress',
  'businessStatus',
  'displayName',
  'formattedAddress',
  'googleMapsLinks',
  'googleMapsUri',
  'iconBackgroundColor',
  'iconMaskBaseUri',
  'location',
  'openingDate',
  'photos',
  'plusCode',
  'postalAddress',
  'primaryType',
  'primaryTypeDisplayName',
  'pureServiceAreaBusiness',
  'shortFormattedAddress',
  'subDestinations',
  'timeZone',
  'types',
  'utcOffsetMinutes',
  'viewport',
])

const ENTERPRISE = new Set([
  'currentOpeningHours',
  'currentSecondaryOpeningHours',
  'internationalPhoneNumber',
  'nationalPhoneNumber',
  'priceLevel',
  'priceRange',
  'rating',
  'regularOpeningHours',
  'regularSecondaryOpeningHours',
  'transitStation',
  'userRatingCount',
  'websiteUri',
])

/*
 * The top band. Deliberately NOT exhaustive, and that is safe: the lookup below
 * already answers `enterprise_atmosphere` for anything it does not recognise,
 * so this set changes no price. It exists so that the one field in it is priced
 * by a decision somebody wrote down rather than by a default nobody chose —
 * `reviews` is the field the call briefing is built on, and a reader working out
 * why one lead costs $0.025 to prepare should find the answer here rather than
 * infer it from the absence of an entry in the three tables above.
 */
const ENTERPRISE_ATMOSPHERE = new Set(['reviews'])

/**
 * Which tier a single field lands in.
 *
 * An unrecognised field returns the most expensive tier on purpose. Google adds
 * fields faster than this table will be updated, and a cost guard that guesses
 * low is worse than useless — it authorises spending that then happens anyway.
 * Guessing high, at worst, makes the operator re-check a number.
 */
export function tierForField(field: string): Tier {
  const leaf = field.startsWith('places.') ? field.slice('places.'.length) : field
  // Sub-field masks like `places.location.latitude` bill as their parent.
  const root = leaf.split('.')[0]

  if (IDS_ONLY.has(root)) return 'ids_only'
  if (PRO.has(root)) return 'pro'
  if (ENTERPRISE.has(root)) return 'enterprise'
  if (ENTERPRISE_ATMOSPHERE.has(root)) return 'enterprise_atmosphere'
  return 'enterprise_atmosphere'
}

/** The tier a whole request bills at: the most expensive field in its mask. */
export function tierForFields(fields: readonly string[]): Tier {
  let highest: Tier = 'ids_only'
  for (const field of fields) {
    const tier = tierForField(field)
    if (TIER_RANK[tier] > TIER_RANK[highest]) highest = tier
  }
  return highest
}

/* ------------------------------------------------------------------------- *
 * Rates
 * ------------------------------------------------------------------------- */

/** Google's pricing categories, which is what the free monthly allowance keys off. */
const FREE_UNITS_PER_MONTH: Record<Tier, number> = {
  // Billed at $0 and documented as unlimited, so no allowance to track.
  ids_only: Number.POSITIVE_INFINITY,
  pro: 5_000,
  enterprise: 1_000,
  enterprise_atmosphere: 1_000,
}

type Endpoint = 'text_search' | 'nearby_search' | 'place_details'

const USD_PER_1000: Record<Endpoint, Record<Tier, number>> = {
  text_search: { ids_only: 0, pro: 32, enterprise: 35, enterprise_atmosphere: 40 },
  nearby_search: { ids_only: 0, pro: 32, enterprise: 35, enterprise_atmosphere: 40 },
  place_details: { ids_only: 0, pro: 17, enterprise: 20, enterprise_atmosphere: 25 },
}

const ENDPOINT_LABEL: Record<Endpoint, string> = {
  text_search: 'Text Search',
  nearby_search: 'Nearby Search',
  place_details: 'Place Details',
}

const TIER_LABEL: Record<Tier, string> = {
  ids_only: 'Essentials (IDs only)',
  pro: 'Pro',
  enterprise: 'Enterprise',
  enterprise_atmosphere: 'Enterprise + Atmosphere',
}

/** Geocoding is priced per request, not per field — it has no mask to derive from. */
export const GEOCODING_SKU = 'google_places.geocoding'
const GEOCODING_USD_PER_1000 = 5
const GEOCODING_FREE_UNITS_PER_MONTH = 10_000

/** Stable SKU id written to the usage ledger. Endpoint and tier, never a price. */
export function skuId(endpoint: Endpoint, tier: Tier): string {
  return `google_places.${endpoint}.${tier}`
}

export function skuLabel(endpoint: Endpoint, tier: Tier): string {
  return `${ENDPOINT_LABEL[endpoint]} ${TIER_LABEL[tier]}`
}

export function unitPriceUsd(endpoint: Endpoint, tier: Tier): number {
  return USD_PER_1000[endpoint][tier] / 1000
}

/**
 * The full rate card, flattened for the ledger.
 *
 * Exported as data rather than as a lookup function because the cost layer
 * needs to reason about SKUs it did not create — a ledger row written last
 * month still has to be explainable this month.
 */
export function buildRateCard() {
  const card: Record<
    string,
    { label: string; unitPriceUsd: number; freeUnitsPerMonth: number }
  > = {}

  for (const endpoint of Object.keys(USD_PER_1000) as Endpoint[]) {
    for (const tier of TIERS) {
      card[skuId(endpoint, tier)] = {
        label: skuLabel(endpoint, tier),
        unitPriceUsd: unitPriceUsd(endpoint, tier),
        freeUnitsPerMonth: FREE_UNITS_PER_MONTH[tier],
      }
    }
  }

  card[GEOCODING_SKU] = {
    label: 'Geocoding',
    unitPriceUsd: GEOCODING_USD_PER_1000 / 1000,
    freeUnitsPerMonth: GEOCODING_FREE_UNITS_PER_MONTH,
  }

  return card
}

/* ------------------------------------------------------------------------- *
 * Masks
 *
 * One mask per stage, each asking for exactly what that stage renders and
 * nothing else. They are `as const` so the tier is derivable at a glance and
 * a stray addition shows up as a price change in the UI, not a surprise on the
 * invoice.
 * ------------------------------------------------------------------------- */

/**
 * Discovery. Every field here is one the results table actually draws.
 *
 * `websiteUri`, `rating` and `userRatingCount` put this in Enterprise. They
 * stay: a discovery row without them cannot answer "is this business worth
 * approaching", which is the only question the search surface asks.
 */
export const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
  'places.googleMapsUri',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.nationalPhoneNumber',
  'nextPageToken',
] as const

/**
 * Enrichment for one place, at save or refresh time. Same signals, unprefixed,
 * plus the address components the leads table breaks out into city/region.
 */
export const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'addressComponents',
  'location',
  'primaryType',
  'types',
  'businessStatus',
  'googleMapsUri',
  'websiteUri',
  'rating',
  'userRatingCount',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
] as const

/**
 * Reviews, and nothing else. Asked once per call, never per lead.
 *
 * The whole reason this mask exists separately: `reviews` is the only field this
 * codebase asks for that lands in Enterprise + Atmosphere, and `tierForFields`
 * prices a request at its most expensive field. Adding it to
 * `DETAILS_FIELD_MASK` would lift EVERY Place Details call — the enrichment at
 * save time, and the nightly refresh across the whole book — from $20/1000 to
 * $25/1000 and, far worse, would spend the shared 1,000-call monthly allowance
 * on leads nobody will ever ring.
 *
 * Kept this way the arithmetic is the operator's own: a refresh costs what it
 * costs, and reviews cost one request each time he decides to phone somebody.
 *
 * `id` rides along at ids_only so a response can be matched to what was asked
 * for; it changes neither the tier nor the price.
 */
export const REVIEWS_FIELD_MASK = ['id', 'reviews'] as const

export const SEARCH_TIER = tierForFields(SEARCH_FIELD_MASK)
export const DETAILS_TIER = tierForFields(DETAILS_FIELD_MASK)
export const REVIEWS_TIER = tierForFields(REVIEWS_FIELD_MASK)
