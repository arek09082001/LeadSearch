import 'server-only'

import { GooglePlacesProvider } from '@/lib/providers/google-places/provider'
import { GooglePlacesReviewProvider } from '@/lib/providers/google-places/reviews'
import type { LeadProvider, ReviewProvider } from '@/lib/providers/types'

/*
 * The registry. One line changes when a second provider arrives.
 *
 * Providers are constructed once and shared: they hold no per-request state,
 * and the API key is read at call time rather than at construction, so a single
 * instance is safe across requests and cannot pin a stale key.
 *
 * `searches.provider` and every `api_usage.sku` are stamped with the id below,
 * which is what keeps a cost report readable after the default changes.
 */
const PROVIDERS: Record<string, LeadProvider> = {
  google_places: new GooglePlacesProvider(),
}

export const DEFAULT_PROVIDER_ID = 'google_places'

export function getProvider(id: string = DEFAULT_PROVIDER_ID): LeadProvider {
  const provider = PROVIDERS[id]
  if (!provider) {
    throw new Error(`Unknown lead provider "${id}".`)
  }
  return provider
}

export function listProviders(): LeadProvider[] {
  return Object.values(PROVIDERS)
}

/*
 * The review sources, kept in their own registry.
 *
 * A separate map rather than a second method on `LeadProvider`, because the two
 * questions come apart: a discovery source that returns no reviews is perfectly
 * usable, and a review source that cannot discover anything is exactly what a
 * fuller review API would be. Today one company answers both, and the ids match
 * so the ledger reads as one provider — which is the truth about the invoice.
 */
const REVIEW_PROVIDERS: Record<string, ReviewProvider> = {
  google_places: new GooglePlacesReviewProvider(),
}

export function getReviewProvider(id: string = DEFAULT_PROVIDER_ID): ReviewProvider {
  const provider = REVIEW_PROVIDERS[id]
  if (!provider) {
    throw new Error(`Unknown review provider "${id}".`)
  }
  return provider
}

export * from '@/lib/providers/types'
