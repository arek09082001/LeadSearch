import { prepareBriefing } from '@/lib/assistant/run'
import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { Deadline } from '@/lib/deadline'

/*
 * Prepare one call.
 *
 * POST only, and no GET: preparing writes a row and may spend a billable
 * request, and a read that did either of those would make a page load a side
 * effect. The briefing that already exists is read by the lead page itself,
 * through the repository, like everything else on it.
 *
 * One lead per request. There is no batch form and there should not be — a
 * briefing is prepared in the seconds before a number is dialled, and preparing
 * forty of them would spend forty billable review requests on thirty-nine calls
 * that are not about to happen.
 *
 * Synchronous rather than through `after()`. The operator is waiting with the
 * phone in his hand; work handed to the background would redraw the page
 * without the thing he pressed the button for.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/*
 * Sixty rather than thirty, and a deadline inside it rather than nothing.
 *
 * THIRTY WAS NOT ENOUGH AND THE WAY IT FAILED WAS THE WORSE HALF. Sonnet thinks
 * before it writes a briefing — see `thinkingFor` — and a request that reached
 * the platform's limit was killed rather than answered: the browser got the
 * gateway's HTML where it asked for JSON and the operator read a parse error
 * about the letter A. The ceiling is now high enough for the work, and the work
 * is bounded a few seconds under it so that running out of time is something
 * this route says in a sentence.
 *
 * NOT HIGHER THAN SIXTY, THOUGH, and the reason is not the platform's. A man is
 * standing there with a phone in his hand. Ninety seconds of waiting is not a
 * slower briefing, it is a briefing he has already given up on — so a minute is
 * both the ceiling and the honest promise, and past it he is told to press the
 * button again rather than kept waiting.
 */
export const maxDuration = 60

/**
 * What the work gets, out of the sixty the platform allows.
 *
 * The five seconds held back are the response: writing the briefing row and
 * serialising it happen after the model has answered, and a budget that used the
 * whole limit would time out in the one place where everything had gone right.
 */
const BUDGET_MS = 55_000

export async function POST(request: Request) {
  const deadline = Deadline.in(BUDGET_MS, 'Preparing the briefing')

  try {
    await requireSession()

    const body = (await readJson(request)) as { leadId?: unknown }
    const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : ''
    if (!leadId) throw new Error('A lead id is required to prepare a call.')

    /*
     * Raced rather than merely signalled. The model and the review fetch both
     * honour the signal and stop; a Supabase call that hangs does not, and this
     * is what keeps one of those from turning into the platform's timeout page
     * again. See `Deadline.rejected`.
     */
    const prepared = await Promise.race([prepareBriefing(leadId, deadline), deadline.rejected()])

    return Response.json({
      briefing: prepared.briefing,
      // Surfaced rather than swallowed. The briefing is complete without
      // reviews, and the operator is entitled to know it was written without
      // them — a ceiling that refused, a Google that did not answer, or one that
      // did not answer in time.
      reviewsError: prepared.reviewsError,
      reviewsCached: prepared.reviewsCached,
    })
  } catch (error) {
    return errorResponse(error)
  } finally {
    deadline.release()
  }
}
