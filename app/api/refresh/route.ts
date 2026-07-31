import { after } from 'next/server'

import { errorResponse, requireOperatorOrSchedule } from '@/lib/api/guard'
import { runScoring } from '@/lib/scoring/run'
import { countRefreshDue, runRefresh } from '@/lib/refresh/run'

/*
 * The refresh, as a surface.
 *
 * GET answers "how much is out of date?" and answers only that. It is a read,
 * and a read that quietly spent money against the Google API would make every
 * page load a billable event.
 *
 * POST runs a slice. With ids it refreshes those leads now, whatever their age —
 * that is the operator asking about these businesses. With none it takes the
 * oldest snapshots past the staleness line and also sweeps the slow re-audit
 * cadence, which is what the nightly schedule wants.
 *
 * THIS ROUTE SPENDS MONEY, which is why it is the only one gated by
 * `requireOperatorOrSchedule` rather than a session alone: the schedule has no
 * cookie, and the alternative — a session-free route — would be an open door to
 * the API key. Inside, the pass runs under the same SpendGuard as a search and
 * stops the moment the monthly ceiling refuses.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** One click must not be able to queue a thousand billable requests. */
const MAX_IDS = 200

export async function GET(request: Request) {
  try {
    await requireOperatorOrSchedule(request)
    return Response.json(await countRefreshDue())
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const caller = await requireOperatorOrSchedule(request)

    // An empty body is the "sweep whatever is due" form, not a malformed
    // request, so this does not go through readJson — that one is right to be
    // strict, and the scheduler sends no body at all.
    const body = await request
      .text()
      .then((text) => (text ? (JSON.parse(text) as Record<string, unknown>) : {}))
      .catch(() => {
        throw new Error('Malformed request body.')
      })

    const ids = Array.isArray(body.leadIds)
      ? body.leadIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_IDS)
      : []

    /*
     * Run in front of the response rather than after it, unlike the audit pass.
     *
     * The operator pressed this and is looking at the result: he needs to be
     * told what changed, and — more to the point — told when the monthly ceiling
     * refused, which is a thing he has to act on rather than discover later in a
     * log. The pass is bounded by its own deadline, so the wait is finite.
     */
    const pass = await runRefresh({
      leadIds: ids.length ? ids : null,
      source: caller === 'operator' ? 'manual' : 'scheduled',
    })

    /*
     * A refresh that invalidated an audit has re-queued it, but the audit pass
     * itself is the audit route's job — nudging it here would run two passes
     * against the same queue on one request. Scoring, though, is free and pure,
     * and any lead whose audit settled since the last poll is one this pass just
     * changed the inputs for.
     */
    after(async () => {
      await runScoring()
    })

    return Response.json({ ...pass, due: await countRefreshDue() })
  } catch (error) {
    return errorResponse(error)
  }
}
