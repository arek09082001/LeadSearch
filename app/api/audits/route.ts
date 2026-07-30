import { after } from 'next/server'

import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { countPending, runEnrichment } from '@/lib/enrichment/run'
import { queueEnrichment } from '@/lib/leads/repository'

/*
 * The audit queue, as a surface.
 *
 * GET answers "is anything still being audited?", which is what the library
 * polls while the amber `auditing` marks are on screen. POST queues leads and
 * kicks the pass — the same machinery the save route uses, exposed so that a
 * run interrupted by a dead invocation can be restarted without saving
 * anything again.
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
    const body = (await readJson(request)) as Record<string, unknown>
    const ids = Array.isArray(body.leadIds)
      ? body.leadIds.filter((id): id is string => typeof id === 'string')
      : []

    const queued = ids.length ? await queueEnrichment(ids) : 0

    // With no ids, this is a plain "keep going" — it drains whatever is already
    // queued rather than requeueing anything.
    after(() => runEnrichment(ids.length ? ids : null))

    return Response.json({ queued, pending: await countPending() })
  } catch (error) {
    return errorResponse(error)
  }
}
