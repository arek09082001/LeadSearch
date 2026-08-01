import { prepareBriefing } from '@/lib/assistant/run'
import { errorResponse, readJson, requireSession } from '@/lib/api/guard'

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
export const maxDuration = 30

export async function POST(request: Request) {
  try {
    await requireSession()

    const body = (await readJson(request)) as { leadId?: unknown }
    const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : ''
    if (!leadId) throw new Error('A lead id is required to prepare a call.')

    const prepared = await prepareBriefing(leadId)

    return Response.json({
      briefing: prepared.briefing,
      // Surfaced rather than swallowed. The briefing is complete without
      // reviews, and the operator is entitled to know it was written without
      // them — a ceiling that refused, or a Google that did not answer.
      reviewsError: prepared.reviewsError,
      reviewsCached: prepared.reviewsCached,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
