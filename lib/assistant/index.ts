import 'server-only'

import { MockBriefingProvider } from '@/lib/assistant/mock'
import type { BriefingProvider } from '@/lib/assistant/types'

/*
 * The assistant registry. One line changes when a model arrives.
 *
 * The switch is an environment variable and the default is the mock, which is
 * the rule this whole product is built under until the model phase: every
 * external capability sits behind an interface with a fixture-backed
 * implementation, and the fixture one is what runs unless somebody deliberately
 * says otherwise. A default that reached for a paid model the moment a key
 * happened to be present would be a default that spends money by accident.
 *
 * `call_briefings.provider` is stamped with the id below, which is what keeps a
 * briefing read six weeks later explainable after the default has changed.
 */

const PROVIDERS: Record<string, BriefingProvider> = {
  mock: new MockBriefingProvider(),
}

export const DEFAULT_BRIEFING_PROVIDER_ID = 'mock'

export function getBriefingProvider(id?: string): BriefingProvider {
  const wanted = id ?? process.env.ASSISTANT_PROVIDER ?? DEFAULT_BRIEFING_PROVIDER_ID
  const provider = PROVIDERS[wanted]
  if (!provider) {
    /*
     * Named, and named loudly. The likely way to arrive here is setting
     * ASSISTANT_PROVIDER to the model provider that has not been built yet, and
     * a silent fall back to the mock would answer that with a briefing that
     * looks exactly like the one a model would have produced.
     */
    throw new Error(
      `Unknown briefing provider "${wanted}". Available: ${Object.keys(PROVIDERS).join(', ')}.`,
    )
  }
  return provider
}

export * from '@/lib/assistant/types'
