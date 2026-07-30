/*
 * The provider boundary.
 *
 * Everything above this file — the search orchestrator, the route handler, the
 * results table — is written against these types and never against Google.
 * Adding Outscraper or Apify later means writing one more module that satisfies
 * `LeadProvider`; nothing above this line changes.
 *
 * Three decisions are what make that swap real rather than merely plausible:
 *
 *  1. Discovery is an async generator, not a promise of an array. Every
 *     provider paginates, and the operator wants rows on screen as they land,
 *     so pagination belongs in the contract instead of being re-implemented by
 *     each caller.
 *
 *  2. Cost is reported BY the provider. Google bills per request at a tier
 *     derived from the field mask; Outscraper bills per returned row. A caller
 *     that computed cost itself would have to know which provider it was
 *     talking to — exactly what this boundary exists to prevent.
 *
 *  3. The spend guard is a callback passed IN, not a check done after. A
 *     provider that paginates must be stoppable between pages, so the ceiling
 *     is enforced at the only place that can honour it: immediately before each
 *     billable request.
 */

/**
 * A business as this app understands it, with nothing Google-shaped left in it.
 *
 * Every field except the id is nullable, because "this provider did not tell
 * us" and "the business does not have one" are different facts and only the
 * second is interesting. `website: null` is the whole product thesis; it must
 * never be confused with a field we simply did not request.
 */
export interface ProviderPlace {
  /** Stable identifier within this provider. Google's place ID; the one Google field we may keep. */
  providerPlaceId: string
  name: string | null
  formattedAddress: string | null
  lat: number | null
  lng: number | null
  phone: string | null
  /** null means no website was reported — the signal this product is built on. */
  website: string | null
  rating: number | null
  userRatingCount: number | null
  businessStatus: string | null
  /** Provider's own category token, verbatim (e.g. `dentist`). Formatting is the UI's job. */
  primaryType: string | null
  types: string[]
  mapsUri: string | null
  /** Verbatim provider payload, kept for the audit trail and for fields we do not model yet. */
  raw: unknown
}

/** A location string resolved to a point. Cached by the caller, not the provider. */
export interface ResolvedLocation {
  lat: number
  lng: number
  formattedAddress: string
}

/** What the operator asked for, in provider-neutral terms. */
export interface SearchQuery {
  /** Free text, e.g. "Zahnarzt". */
  query: string
  /** As typed, e.g. "Heilbronn". Providers may fold this into the query itself. */
  location?: string
  /** `location` already resolved to a point, when the caller had one cached. */
  center?: { lat: number; lng: number }
  /** Ignored unless `center` is set — a radius with no centre is not a search. */
  radiusM?: number
  /** Provider category token, e.g. a Google Places type like `dentist`. */
  category?: string
  /** Ceiling on results. Providers stop paginating once they reach it. */
  maxResults?: number
  languageCode?: string
  regionCode?: string
}

/**
 * One billable event, priced at list. Whether it is actually charged depends on
 * the month-to-date free allowance, which the provider has no way to know — so
 * that decision belongs to the cost ledger, not here.
 */
export interface CostEvent {
  /** Provider-scoped SKU id, e.g. `google_places.text_search.enterprise`. */
  sku: string
  /** How the operator would name it. */
  label: string
  /** Billable units: requests for Google, returned rows for a per-row provider. */
  units: number
  /** List price per unit, USD. */
  unitPriceUsd: number
  /** units × unitPriceUsd, before any free allowance. */
  listAmountUsd: number
}

/** A provider's published prices. The cost ledger reads this; nothing hardcodes it. */
export interface RateCard {
  [sku: string]: {
    label: string
    unitPriceUsd: number
    /**
     * Units this SKU gives away each calendar month. Google grants these per
     * SKU; a provider with no free tier reports 0.
     */
    freeUnitsPerMonth: number
  }
}

/** One page of discovery results, priced. */
export interface SearchPage {
  /** Zero-based. Page 0 is the first request. */
  pageIndex: number
  places: ProviderPlace[]
  /** What this page cost at list price. Empty when served from cache. */
  cost: CostEvent[]
  /** True when the provider has another page it could fetch. */
  hasMore: boolean
}

/** Enrichment for a single place, priced the same way. */
export interface DetailsResult {
  place: ProviderPlace
  cost: CostEvent[]
}

/**
 * Per-call environment. The two callbacks are how the ceiling is enforced and
 * the ledger is written without the provider knowing either exists.
 */
export interface ProviderContext {
  signal?: AbortSignal
  /**
   * Called immediately before every billable request, with that request priced
   * at list. Throw to stop the provider — a `BudgetExceededError` is the
   * expected way to refuse.
   */
  authorizeSpend?: (pending: CostEvent) => Promise<void> | void
  /** Called after a billable request returns, successfully or not. */
  recordSpend?: (spent: CostEvent) => Promise<void> | void
}

/** What a search will cost if nothing is cached — shown before the operator commits. */
export interface SearchEstimate {
  /** Worst case: every page fetched, up to `maxResults`. */
  maxRequests: number
  maxCostUsd: number
  /** The SKU the field mask lands on, so the operator can see why it costs what it costs. */
  sku: string
  label: string
}

export interface LeadProvider {
  /** Stable id, written to `searches.provider`. */
  readonly id: string
  readonly label: string
  readonly rateCard: RateCard

  /**
   * Discovery. Yields pages as they arrive and stops when the provider runs
   * out, `maxResults` is reached, or `authorizeSpend` throws.
   */
  search(query: SearchQuery, ctx?: ProviderContext): AsyncGenerator<SearchPage, void, void>

  /** Enrichment for one place. Separate from search because it bills separately. */
  getDetails(providerPlaceId: string, ctx?: ProviderContext): Promise<DetailsResult>

  /** Priced up front, without making a request. */
  estimateSearch(query: SearchQuery): SearchEstimate

  /**
   * Turn typed location text into a point, so a radius can mean something.
   *
   * Optional: a provider that accepts place names directly has nothing to
   * resolve. Where it exists it is a separate billable event with a much
   * longer useful life than a search — a town centre does not move — so the
   * caller caches it and the provider only knows how to fetch it. Returns null
   * when the text matched nothing.
   */
  resolveLocation?(text: string, ctx?: ProviderContext): Promise<ResolvedLocation | null>
}

/**
 * Thrown by the spend guard, not by the provider. Separate from a transport
 * failure because it is not an error condition — it is the ceiling working.
 */
export class BudgetExceededError extends Error {
  readonly monthToDateUsd: number
  readonly ceilingUsd: number

  constructor(monthToDateUsd: number, ceilingUsd: number) {
    super(
      `Monthly API ceiling reached: $${monthToDateUsd.toFixed(2)} of $${ceilingUsd.toFixed(2)}. ` +
        `Raise the ceiling in Search settings to continue.`,
    )
    this.name = 'BudgetExceededError'
    this.monthToDateUsd = monthToDateUsd
    this.ceilingUsd = ceilingUsd
  }
}

/** A provider refused or failed. Carries the stage so the UI can say what broke. */
export class ProviderError extends Error {
  readonly stage: 'geocode' | 'search' | 'details'
  readonly status?: number

  constructor(stage: ProviderError['stage'], message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.stage = stage
    this.status = status
  }
}
