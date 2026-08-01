import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { markTipActedOn, readCall, writeTip } from '@/lib/assistant/store'
import { isTipTrigger } from '@/lib/assistant/vocabulary'

/*
 * What the assistant said, and whether it was any use.
 *
 * A LOG, NOT A GENERATOR. Nothing here decides anything: the tip was decided in
 * the tab, by `lib/assistant/triggers.ts`, before this route was called — that
 * is the whole point of the trigger being a pure function, and it is why this
 * file has no assistant import in it. The rows exist so that "does this help"
 * becomes an answerable question later, the way `insight/outcomes.ts` answers it
 * for finding codes.
 *
 * WHICH MEANS IT MUST NOT COST THE CALL ANYTHING. The surface fires this and
 * does not wait for it; a failure here is a missing row in an analysis nobody
 * runs for months, and the operator is on the phone. It stays a POST rather than
 * a batch-at-hangup for the reason the segments route does: a tab that crashes
 * mid-call would otherwise take the record of the assistant's behaviour with it,
 * exactly on the calls that went long enough to be interesting.
 *
 * PATCH writes `acted_on` and nothing else. It is the operator's own verdict on
 * one tip and the only column in this table he writes by hand.
 *
 * Unlike the segments route this one ACCEPTS A CLOSED CALL. A tip shown at the
 * last second is a tip that was shown, and a keypress marking it as used lands
 * after he has hung up rather than before.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * The bound on a stored tip.
 *
 * Not `MAX_TIP_WORDS`. The word limit is a layout rule the surface enforces on
 * itself, and a route that re-checked it would be a route that rejects a tip
 * the operator has already read on screen. This is the other kind of bound —
 * against a body that could only have come from something malfunctioning.
 */
const MAX_BODY = 500

export async function POST(request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params

    const body = (await readJson(request)) as {
      atMs?: unknown
      trigger?: unknown
      body?: unknown
      shown?: unknown
    }

    const atMs =
      typeof body.atMs === 'number' && Number.isFinite(body.atMs) ? Math.round(body.atMs) : -1
    if (atMs < 0) throw new Error('A tip needs a non-negative atMs.')

    const trigger = typeof body.trigger === 'string' ? body.trigger : ''
    // Closed vocabulary, checked here rather than trusted. `call_tips.trigger`
    // is text so the list can grow without a migration, which is exactly why
    // the value arriving has to be one this build actually knows.
    if (!isTipTrigger(trigger)) throw new Error(`"${trigger}" is not a trigger this build has.`)

    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (!text) throw new Error('A tip with no body is not a tip.')

    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })

    const tipId = await writeTip({
      callId: id,
      atMs,
      trigger,
      body: text.slice(0, MAX_BODY),
      shown: body.shown === true,
    })

    return Response.json({ id: tipId })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params

    const body = (await readJson(request)) as { id?: unknown }
    const tipId = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : -1
    if (tipId < 0) throw new Error('Which tip was used?')

    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })

    await markTipActedOn(id, tipId)
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
