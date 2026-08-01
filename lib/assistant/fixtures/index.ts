import { DATED_SITE } from '@/lib/assistant/fixtures/dated-site'
import { NOTHING_FOUND } from '@/lib/assistant/fixtures/nothing-found'
import { NO_IMPRINT } from '@/lib/assistant/fixtures/no-imprint'
import { NO_WEBSITE } from '@/lib/assistant/fixtures/no-website'
import type { AssistantFixture } from '@/lib/assistant/fixtures/types'

/*
 * The fixture registry, and the order is the whole content of this file.
 *
 * A real lead carries several faults at once — the shop with no website is often
 * also the shop with no Impressum, because there is no page for one to be on.
 * So "which fixture" is really "which fault opens the call", and that is a
 * judgement about selling rather than an implementation detail:
 *
 *   1. NO WEBSITE first. It is not one fault among several; it is a different
 *      conversation, and every other finding is a fact about a site that does
 *      not exist.
 *   2. NO IMPRINT before the dated site. It is the shortest call in the book,
 *      the fact is not arguable, and it opens a door on a site that is otherwise
 *      merely tired.
 *   3. THE DATED SITE last of the three, because it is the call that needs the
 *      most talking and the operator most benefits from having tried a shorter
 *      one first.
 *   4. NOTHING FOUND never wins. It claims nothing and is reached only by
 *      falling through, which is how a fallback should be reachable.
 *
 * The same ordering question will be put to the real provider in Phase 17, where
 * it will be a sentence of prompt rather than an array. Writing it down here is
 * how it survives the swap.
 */
export const FIXTURES: readonly AssistantFixture[] = [
  NO_WEBSITE,
  NO_IMPRINT,
  DATED_SITE,
  NOTHING_FOUND,
]

/** Reached when nothing claims the call. Not a failure — see the fixture. */
export const FALLBACK_FIXTURE = NOTHING_FOUND

/**
 * Which conversation this is, from the diagnosis.
 *
 * Takes codes rather than a `BriefingInput` so that the same answer can be got
 * from a list of strings in a node session, and so nothing in the selection can
 * quietly start depending on the lead.
 */
export function selectFixture(codes: readonly string[]): AssistantFixture {
  const found = new Set(codes)
  return (
    FIXTURES.find((fixture) => fixture.claims.some((code) => found.has(code))) ?? FALLBACK_FIXTURE
  )
}

/**
 * The conversations a lead could possibly be having, in registry order.
 *
 * For the callers that have no diagnosis to select on — the summary, and a tip
 * asked for before a briefing exists. One fact does most of the work: a business
 * with a live website is not the business with no website, whatever turns up in
 * the transcript. See `requiresWebsite` for the case that made this necessary.
 */
export function eligibleFixtures(hasWebsite: boolean): AssistantFixture[] {
  return FIXTURES.filter(
    (fixture) => fixture.requiresWebsite === null || fixture.requiresWebsite === hasWebsite,
  )
}

export { DATED_SITE, NOTHING_FOUND, NO_IMPRINT, NO_WEBSITE }
export * from '@/lib/assistant/fixtures/types'
