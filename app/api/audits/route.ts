import { after } from 'next/server'

import { errorResponse, requireSession } from '@/lib/api/guard'
import { countPending, runEnrichment } from '@/lib/enrichment/run'
import { queueEnrichment } from '@/lib/leads/repository'

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

    after(() => runEnrichment(ids.length ? ids : null))

    return Response.json({ queued, pending: await countPending() })
  } catch (error) {
    return errorResponse(error)
  }
}
