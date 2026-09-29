import { after } from 'next/server'

import { errorResponse, requireSession } from '@/lib/api/guard'
import { countPending, runEnrichment } from '@/lib/enrichment/run'
import { queueEnrichment } from '@/lib/leads/repository'
import { runScoring } from '@/lib/scoring/run'

/*
 * The audit queue, as a surface.
 *
 * GET answers "is anything still being audited?" and answers ONLY that — it is
 * a read, and a read that quietly started work would make every page load a
 * side effect.
 *
 * POST is the verb that moves the queue. With ids it queues those leads and
 * runs; with none it is a plain "keep going", which drains whatever is already
 * waiting in either stage. That second form is what the library polls while the
 * amber `auditing` marks are on screen: a pass is bounded by the function's
 * lifetime, so something has to keep asking for the next slice, and the surface
 * that already knows the work is outstanding is the honest place for it.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    await requireSession()
    return Response.json({ pending: await countPending() })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    await requireSession()

    // An empty body is the "keep going" form, not a malformed request, so this
    // does not go through readJson — that one is right to be strict.
    const body = await request
      .text()
      .then((text) => (text ? (JSON.parse(text) as Record<string, unknown>) : {}))
      .catch(() => {
        throw new Error('Malformed request body.')
      })

    const ids = Array.isArray(body.leadIds)
      ? body.leadIds.filter((id): id is string => typeof id === 'string')
      : []

    const queued = ids.length ? await queueEnrichment(ids) : 0

    /*
     * Scoring rides along after the audit pass, in the same background work.
     *
     * After, not beside: a score is computed from findings that have to exist
     * first, and the pass this just ran is what writes them. Chaining it here
     * rather than inside the pipeline keeps the two separable — the enrichment
     * pass still knows nothing about ranking, and scoring stays a pure function
     * of rows already written.
     *
     * It costs nothing to add. There is no network under `runScoring`, and the
     * queue it drains is empty in the steady state, so the poll that keeps the
     * audit queue moving now also ranks whatever that queue finished.
     *
     * Deliberately NOT narrowed to `ids`, even when the caller named some. The
     * leads just audited are still waiting on PageSpeed and cannot be scored
     * yet — their findings are half-written — so narrowing would score nothing
     * and leave the ones that DID settle since the last poll unranked. The
     * whole queue is the right work list, and it is empty most of the time.
     */
    after(async () => {
      await runEnrichment(ids.length ? ids : null)
      await runScoring()
    })

    return Response.json({ queued, pending: await countPending() })
  } catch (error) {
    return errorResponse(error)
  }
}
