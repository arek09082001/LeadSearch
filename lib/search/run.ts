import 'server-only'

import { DEFAULT_PROVIDER_ID, getProvider } from '@/lib/providers'
import {
  BudgetExceededError,
  ProviderError,
  type ResolvedLocation,
  type SearchQuery,
} from '@/lib/providers/types'
import { SpendGuard, getBudgetState } from '@/lib/search/cost'
import {
  createSearch,
  finalizeSearch,
  findReplayableSearch,
  markSavedLeads,
  paramsHash,
  persistResults,
  readGeocodeCache,
  writeGeocodeCache,
} from '@/lib/search/repository'
import type { SearchEvent, SearchInput } from '@/lib/search/types'

/*
 * One search, start to finish, as a stream of events.
 *
 * The order of operations is the cost policy, expressed as control flow:
 *
 *   1. Can this be answered from a search already paid for?   -> free, stop here
 *   2. Is the location already resolved in the cache?         -> one fewer call
 *   3. Ask permission before every remaining request           -> the ceiling
 *   4. Record every request, successful or not                 -> the ledger
 *
 * Nothing downstream needs to know any of that. It reads events.
 */

/** Google's own ceiling for a single Text Search result set. */
const DEFAULT_MAX_RESULTS = 60

/**
 * A clicked point, as something a person can read back.
 *
 * Five decimals is about a metre — past what a click can mean and short of the
 * float noise that would make the same spot print differently twice.
 */
function formatPoint(center: { lat: number; lng: number }): string {
  return `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`
}

export async function* runSearch(
  input: SearchInput,
  /** Aborted when the operator navigates away — stops us paying for a page nobody will read. */
  signal?: AbortSignal,
): AsyncGenerator<SearchEvent, void, void> {
  const providerId = input.providerId ?? DEFAULT_PROVIDER_ID
  const provider = getProvider(providerId)
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS

  if (!input.query.trim() && !input.category) {
    yield { type: 'error', message: 'Enter a query or pick a category before searching.' }
    return
  }

  const hash = paramsHash({ ...input, maxResults }, providerId)

  /* --- 1. The search we already paid for -------------------------------- */

  if (!input.refresh) {
    const replay = await findReplayableSearch(hash)
    if (replay) {
      const rows = await markSavedLeads(replay.places, replay.fetchedAt)
      yield {
        type: 'meta',
        searchId: replay.searchId,
        provider: providerId,
        estimate: provider.estimateSearch({ ...input, maxResults }),
        budget: await getBudgetState(),
        cached: true,
        cachedAt: replay.fetchedAt,
      }
      yield { type: 'results', pageIndex: 0, rows }
      yield { type: 'done', total: rows.length, searchCostUsd: 0, cached: true }
      return
    }
  }

  /* --- 2. Everything from here on can cost money ------------------------- */

  const guard = await SpendGuard.create()

  /*
   * The provider context is assembled here rather than being the guard itself:
   * the guard owns money, the signal owns the connection, and neither should
   * have to know about the other.
   */
  const ctx = {
    signal,
    authorizeSpend: guard.authorizeSpend,
    recordSpend: guard.recordSpend,
  }

  /*
   * Resolve the location only when a radius makes it matter. Without one, the
   * location is folded into the text query and geocoding would be a call bought
   * for nothing.
   *
   * A centre handed in is already the answer that call would have bought, so the
   * call is not made and the cache is not touched. Nothing below this block can
   * tell the two apart: a resolved location is a resolved location, whether it
   * came from Google or from the operator's finger on the map.
   */
  let resolved: ResolvedLocation | null = null
  if (input.center) {
    resolved = {
      lat: input.center.lat,
      lng: input.center.lng,
      // A clicked point has no address, and inventing one — echoing back the
      // text he typed, say — would put a name on this search that nothing
      // resolved. Its own coordinates are the honest label for it.
      formattedAddress: formatPoint(input.center),
    }
  } else if (input.location?.trim() && input.radiusM && provider.resolveLocation) {
    resolved = await readGeocodeCache(input.location)
    if (!resolved) {
      try {
        resolved = await provider.resolveLocation(input.location, ctx)
        if (resolved) await writeGeocodeCache(input.location, resolved, providerId)
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          yield {
            type: 'blocked',
            message: error.message,
            monthToDateUsd: error.monthToDateUsd,
            ceilingUsd: error.ceilingUsd,
          }
          return
        }
        /*
         * A failed geocode is not a failed search. The location text is still
         * in the query, so the search runs unbiased — narrower than asked for,
         * but useful — rather than failing over a refinement.
         */
        console.warn('[search] geocode failed, falling back to text-only', error)
      }
    }
  }

  const searchId = await createSearch(input, providerId, hash, resolved)
  guard.attachSearch(searchId)

  const query: SearchQuery = {
    query: input.query,
    location: input.location,
    category: input.category,
    radiusM: resolved ? input.radiusM : undefined,
    center: resolved ? { lat: resolved.lat, lng: resolved.lng } : undefined,
    maxResults,
  }

  yield {
    type: 'meta',
    searchId,
    provider: providerId,
    estimate: provider.estimateSearch(query),
    budget: await getBudgetState(),
    cached: false,
    resolvedLocation: resolved ?? undefined,
  }

  /* --- 3. Pages, as they land ------------------------------------------- */

  // Deduplication is by place id and spans pages. The provider dedupes its own
  // pagination; this set also catches a provider that does not.
  const seen = new Set<string>()
  let total = 0
  let failure: string | null = null

  try {
    for await (const page of provider.search(query, ctx)) {
      const fresh = page.places.filter((place) => {
        if (seen.has(place.providerPlaceId)) return false
        seen.add(place.providerPlaceId)
        return true
      })

      /*
       * Cache before rendering: if the operator closes the tab mid-search, the
       * rows Google already charged for are still on disk for the replay.
       *
       * A failed cache write does not fail the search, though. Google has been
       * paid either way and the rows are in hand; losing them would turn a
       * database hiccup into twenty businesses the operator never sees. What is
       * lost is the free replay, which is a cost problem, not a data one — so it
       * is logged loudly and the page is yielded regardless.
       */
      try {
        await persistResults(searchId, fresh, total)
      } catch (error) {
        console.error('[search] could not cache a page that was already paid for', {
          searchId,
          pageIndex: page.pageIndex,
          error,
        })
      }
      total += fresh.length

      if (fresh.length) {
        yield { type: 'results', pageIndex: page.pageIndex, rows: await markSavedLeads(fresh) }
      }

      yield {
        type: 'cost',
        searchCostUsd: guard.spentUsd,
        requests: guard.requests,
        monthToDateUsd: guard.monthToDateUsd,
        ceilingUsd: guard.ceilingUsd,
      }
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      /*
       * Not a failure. The ceiling did its job, and whatever arrived before it
       * fired is real data the operator can work with — so the rows stay, the
       * search is finalised normally, and only the reason it stopped is new.
       */
      await finalizeSearch(searchId, { resultCount: total, costUsd: guard.spentUsd })
      yield {
        type: 'blocked',
        message: error.message,
        monthToDateUsd: error.monthToDateUsd,
        ceilingUsd: error.ceilingUsd,
      }
      yield { type: 'done', total, searchCostUsd: guard.spentUsd, cached: false }
      return
    }

    /*
     * An abort is the operator navigating away, not a failure of anything.
     *
     * Recording it as one would put "This operation was aborted" on the search
     * row for ever, and every closed tab would look in the history like a
     * broken search. The rows already fetched are cached and the run is
     * finalised with what it actually got.
     */
    if (signal?.aborted) {
      await finalizeSearch(searchId, { resultCount: total, costUsd: guard.spentUsd })
      return
    }

    failure =
      error instanceof ProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The search failed for an unknown reason.'
  }

  await finalizeSearch(searchId, {
    resultCount: total,
    costUsd: guard.spentUsd,
    error: failure,
  })

  if (failure) {
    /*
     * A failure part way through still emits `done`, and the order matters.
     *
     * Google returning page one and then 500-ing on page two is the ordinary
     * shape of an outage, and those first twenty rows are billed, cached and
     * good. The error says what stopped; `done` carries what was actually
     * fetched and what it cost, so the surface can keep the rows on screen and
     * the ledger and the readout agree.
     */
    yield { type: 'error', message: failure }
    yield { type: 'done', total, searchCostUsd: guard.spentUsd, cached: false }
    return
  }

  yield { type: 'done', total, searchCostUsd: guard.spentUsd, cached: false }
}
