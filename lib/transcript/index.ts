import { BROWSER_TRANSCRIPT_PROVIDER } from '@/lib/transcript/browser/provider'
import { MOCK_TRANSCRIPT_PROVIDER } from '@/lib/transcript/mock/provider'
import type { TranscriptProvider } from '@/lib/transcript/types'

/*
 * The registry. One environment variable, read in one place — the assistant
 * registry's arrangement, with one difference that matters.
 *
 * THIS ONE IS `NEXT_PUBLIC_`, and it is the only variable in this codebase that
 * is. `lib/env.ts` says nothing there is public, and that stays true: this is
 * not a credential and it is not a server setting. The recogniser runs in the
 * browser, so the choice of recogniser has to be made in the browser, and a
 * value the client cannot read is a value that cannot select a client provider.
 * There is nothing to leak — the answer is `mock` or `browser`.
 *
 * THE DEFAULT IS THE MOCK, by the rule the whole project runs on: the behaviour
 * with a consequence is the one that has to be asked for by name. Here the
 * consequence is not a bill but a microphone — an unconfigured build must not
 * be one keystroke away from streaming a stranger's voice to Google because
 * somebody opened a page. Setting the variable is the act of deciding to.
 *
 * Both providers are constructed at import, unlike the assistant's thunk table.
 * Both exist, both are cheap, and neither touches a device until `start()`.
 */

export const DEFAULT_TRANSCRIPT_ID = 'mock'

const PROVIDERS: Record<string, TranscriptProvider> = {
  mock: MOCK_TRANSCRIPT_PROVIDER,
  browser: BROWSER_TRANSCRIPT_PROVIDER,
}

/*
 * Read as a whole expression, not as `process.env[name]`. Next replaces this
 * text at build time; an indexed lookup is not text it can replace, and the
 * value would arrive as undefined in the browser with nothing to show for it.
 */
const CONFIGURED = process.env.NEXT_PUBLIC_TRANSCRIPT_PROVIDER || DEFAULT_TRANSCRIPT_ID

/**
 * The recogniser this build listens through.
 *
 * An unknown id falls back to the mock rather than throwing. The assistant
 * registry throws on the same mistake and is right to — a briefing is prepared
 * before the call and a loud failure gets fixed. This is pressed with the phone
 * already ringing, and a page that will not render is worse than a page that
 * plays a fixture and says so. It does say so: `id` is on the screen.
 */
export function getTranscriptProvider(id: string = CONFIGURED): TranscriptProvider {
  return PROVIDERS[id] ?? PROVIDERS[DEFAULT_TRANSCRIPT_ID]
}

export * from '@/lib/transcript/types'
