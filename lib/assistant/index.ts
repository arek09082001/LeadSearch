import 'server-only'

import { ANTHROPIC_ASSISTANT } from '@/lib/assistant/anthropic/provider'
import { MOCK_ASSISTANT } from '@/lib/assistant/mock/provider'
import { env } from '@/lib/env'
import type { Assistant } from '@/lib/assistant/types'

/*
 * The registry. One environment variable, read in one place.
 *
 * `ASSISTANT_PROVIDER` is the only switch, and the default is `mock` — an
 * unconfigured deployment briefs from fixtures rather than quietly reaching for
 * a model, which is the same way `CRON_SECRET` is handled and for the same
 * reason: the expensive behaviour has to be asked for.
 *
 * STILL A THUNK TABLE now that both entries exist, though the reason has moved.
 * It was written this way because `anthropic` did not exist and a table that had
 * to name a module for it would have imported a file that was not there. What
 * the thunk buys today is smaller and still worth having: both assistants are
 * shared instances holding no per-request state, and neither construction may
 * capture a credential. `ANTHROPIC_API_KEY` is read inside `client.ts` at the
 * moment of a request — see the note in `lib/providers/index.ts` for why a
 * process that outlives a rotated key must not keep using the old one.
 *
 * Note also what does NOT switch here: the mock is not "development" and the
 * model is not "production". Either can be selected in either, because the point
 * of the boundary is that the surface cannot tell — and the day the model
 * misbehaves during a call, the fix is one variable rather than a deploy.
 */

export const DEFAULT_ASSISTANT_ID = 'mock'

const ASSISTANTS: Record<string, () => Assistant> = {
  mock: () => MOCK_ASSISTANT,

  anthropic: () => ANTHROPIC_ASSISTANT,
}

/**
 * The assistant this build speaks through.
 *
 * Every caller goes through here rather than importing a provider directly, so
 * that "which assistant answered" has exactly one answer at runtime and it is
 * the one written into `call_briefings.provider`. The mock is a shared instance
 * because it holds no per-call state; a future real one is expected to be the
 * same, with the key read at call time rather than at construction — the note in
 * `lib/providers/index.ts` explains why that matters.
 */
export function getAssistant(id: string = env.ASSISTANT_PROVIDER): Assistant {
  const build = ASSISTANTS[id]
  if (!build) {
    throw new Error(
      `Unknown assistant provider "${id}". Valid values: ${Object.keys(ASSISTANTS).join(', ')}.`,
    )
  }
  return build()
}

/** Whether this build is answering from fixtures. Worth being able to say on screen. */
export function isMockAssistant(): boolean {
  return env.ASSISTANT_PROVIDER === DEFAULT_ASSISTANT_ID
}

export * from '@/lib/assistant/types'
