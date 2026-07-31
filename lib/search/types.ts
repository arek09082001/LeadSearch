import type { ProviderPlace, SearchEstimate } from '@/lib/providers/types'

/*
 * `BudgetState` lives here rather than beside the code that computes it because
 * the results table renders it, and `lib/search/cost` is `server-only`. Types
 * the client needs cannot live in a module the client may not import.
 */

/** Everything the UI needs to draw the running total, in one object. */
export interface BudgetState {
  ceilingUsd: number
  /** Billed spend this UTC month — what the invoice will say. */
  monthToDateUsd: number
  /** List value of the same calls. Above `monthToDateUsd` by whatever the free tier absorbed. */
  monthToDateListUsd: number
  remainingUsd: number
  /** True once the ceiling is reached. No billable call will be authorised. */
  exhausted: boolean
  /** `YYYY-MM`, UTC — Google's billing month, not the operator's. */
  month: string
  /**
   * The SKU a discovery run bills to. Sent from the server because only it knows
   * the provider; the readout needs it to show the one allowance that matters
   * rather than whichever SKU happens to have the fewest calls left.
   */
  discoverySku: string
  bySku: {
    sku: string
    label: string
    units: number
    billedUsd: number
    /** Calls still free this month. `null` when the SKU has no metered allowance. */
    freeUnitsRemaining: number | null
  }[]
}

/** What the operator filled into the search bar. */
export interface SearchInput {
  query: string
  location?: string
  /**
   * The centre, already known — a point clicked on the map rather than text to
   * be geocoded.
   *
   * When it is set the geocoding step is skipped entirely: `location` is text
   * that has to be turned into a point, and this IS the point. That is one
   * billable Google call fewer per search, which at a ceiling of zero is the
   * difference between a search that runs and one that is refused.
   *
   * It does not start a second kind of search. Everything downstream — the
   * replay cache, the spend guard, the provider, the stream — sees the same
   * resolved centre it would have seen had the text been geocoded, and cannot
   * tell which way it arrived.
   *
   * Needs a `radiusM` to mean anything: a point with no circle around it is not
   * somewhere to search. The route refuses the pair rather than accepting a
   * point it would then ignore.
   */
  center?: { lat: number; lng: number }
  radiusM?: number
  category?: string
  maxResults?: number
  providerId?: string
  /** Skip the replay cache and pay for fresh data. Always an explicit act. */
  refresh?: boolean
}

/**
 * A discovery result as the table draws it: the provider's place, plus the one
 * thing the provider cannot know — whether this business is already in the book.
 */
export interface SearchRow extends ProviderPlace {
  /** Set when this place is already a saved lead. The table marks these clearly. */
  savedLeadId: string | null
  savedStatus: string | null
  /** When the underlying Google data was fetched. Every surface must be able to state this. */
  fetchedAt: string
}

/**
 * The stream protocol between the route handler and the table.
 *
 * One NDJSON object per line, discriminated on `type`. A stream rather than a
 * promise because a 60-result search is three sequential Google round trips and
 * the operator should be reading page one while page three is still in flight.
 */
export type SearchEvent =
  /** Always first. Says what is about to happen and what it will cost at most. */
  | {
      type: 'meta'
      searchId: string | null
      provider: string
      estimate: SearchEstimate
      budget: BudgetState
      /** True when the whole result set is being replayed from cache for nothing. */
      cached: boolean
      /** Age of the replayed data, ISO, when `cached`. */
      cachedAt?: string
      resolvedLocation?: { lat: number; lng: number; formattedAddress: string }
    }
  /** A page of rows, already deduplicated and marked against the leads library. */
  | { type: 'results'; pageIndex: number; rows: SearchRow[] }
  /** Running totals, emitted after every billable page. */
  | {
      type: 'cost'
      searchCostUsd: number
      requests: number
      monthToDateUsd: number
      ceilingUsd: number
    }
  /** The ceiling stopped the search. Any rows already sent remain valid. */
  | { type: 'blocked'; message: string; monthToDateUsd: number; ceilingUsd: number }
  | { type: 'error'; message: string }
  | { type: 'done'; total: number; searchCostUsd: number; cached: boolean }
