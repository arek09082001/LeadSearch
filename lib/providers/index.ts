import 'server-only'

import { GooglePlacesProvider } from '@/lib/providers/google-places/provider'
import type { LeadProvider } from '@/lib/providers/types'

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

export * from '@/lib/providers/types'
