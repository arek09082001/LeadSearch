import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { getAssistant } from '@/lib/assistant'
import { leadOf } from '@/lib/assistant/briefing-input'
import { readCall, readLatestBriefing, readSegments } from '@/lib/assistant/store'
import { AssistantError, type ShownTip } from '@/lib/assistant/types'
import { isTipTrigger } from '@/lib/assistant/vocabulary'
import { Deadline } from '@/lib/deadline'
import { readLead } from '@/lib/leads/repository'

/*
 * The exception. Asked for by hand, and only when the rules had nothing.
 *
 * THIS ROUTE IS NOT THE NORMAL PATH AND IS NOT MEANT TO BECOME ONE. Every tip
 * during a call comes from `lib/assistant/triggers.ts`, in the tab, in no time
 * and at no cost. This is what happens when the operator presses the key
 * because he wants something anyway — a deliberate act, once, not a poll — and
 * it is the only place in a live call where `TipProvider` is reached at all.
 *
 * That constraint is what keeps the ceiling honest. A route that a timer could
 * call would be a route billing per sentence on the longest calls; a route only
 * a keypress can reach is bounded by a human hand. `POST` rather than `GET` for
 * the same reason `prepare` is: under a real provider this spends money, and a
 * request that spends money should not be something a browser can prefetch.
 *
 * WHAT IT DOES NOT DO IS DECIDE WHETHER TO SHOW ANYTHING. It returns the
 * provider's answer, including null, and the surface falls back to `manualTip`
 * — the strongest prepared objection not yet used — without a second round
 * trip. With the fixture-backed mock reading English cues off a German call,
 * null is the usual answer, and the fallback is what makes the key useful today
 * rather than in Phase 17.
 *
 * The tip is NOT logged here. `shown` is a fact about a screen, this route
 * cannot observe one, and a row written from here would claim the operator read
 * something that may never have been drawn. The surface logs it, through
 * `../tips`, when it puts it up.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * What the work gets, out of the thirty.
 *
 * THIRTY STAYS, unlike the other two model routes. Those two raised their limit
 * because the generation behind them genuinely needs the room; this one is Haiku
 * with thinking off, answering a man who pressed a key mid-sentence. A tip that
 * took half a minute would arrive after the moment it was about, so the ceiling
 * here is not the constraint and never was.
 *
 * WHAT THE DEADLINE BUYS IS THE REFUSAL. `attemptFor` will not open a request it
 * cannot finish and will not retry one there is no room to retry, and both of
 * those arrive as an `AssistantError` — which this route already turns into a
 * quiet "unavailable" and the surface already answers with the prepared
 * objection. That is the whole difference: without a deadline the operator waits
 * out the platform's limit for nothing, and with one he gets his fallback tip.
 *
 * NOT RACED, for the same reason. The response this route owes is a 200 with a
 * reason on it, never a gateway error mid-call.
 */
const BUDGET_MS = 25_000

type Context = { params: Promise<{ id: string }> }

/**
 * How much of the transcript goes to the provider.
 *
 * The last minute, not the call. `TipContext.transcript` says the caller bounds
 * it because only the caller knows how much is still relevant — and the whole
 * call re-sent on every ask is the shape of an accidental bill.
 */
const TIP_WINDOW_MS = 60_000

function parseShown(value: unknown): ShownTip[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>
    const trigger = typeof row.trigger === 'string' ? row.trigger : ''
    if (!isTipTrigger(trigger)) return []
    const atMs = typeof row.atMs === 'number' && Number.isFinite(row.atMs) ? Math.round(row.atMs) : 0
    return [{ trigger, atMs: Math.max(0, atMs) }]
  })
}

export async function POST(request: Request, { params }: Context) {
  const deadline = Deadline.in(BUDGET_MS, 'The tip')

  try {
    await requireSession()
    const { id } = await params

    const body = (await readJson(request)) as { atMs?: unknown; shown?: unknown }
    const atMs =
      typeof body.atMs === 'number' && Number.isFinite(body.atMs) ? Math.round(body.atMs) : 0

    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })

    const lead = await readLead(call.leadId)
    if (!lead) return Response.json({ error: 'That call has no lead.' }, { status: 404 })

    const [stored, segments] = await Promise.all([
      readLatestBriefing(call.id, lead.lastAuditedAt),
      readSegments(call.id),
    ])

    const at = Math.max(atMs, 0)
    const tip = await getAssistant().tip.suggest(
      {
        callId: call.id,
        atMs: at,
        lead: leadOf(lead),
        consentNoted: call.consentNoted,
        briefing: stored?.briefing ?? null,
        transcript: segments.filter((segment) => segment.atMs >= at - TIP_WINDOW_MS),
        alreadyShown: parseShown(body.shown),
      },
      { signal: deadline.signal, deadline, callId: call.id },
    )

    // Null is a real answer and travels as one. The surface knows what to do
    // with it, and dressing it up as an error would make the honest case look
    // like a broken one.
    return Response.json({ tip })
  } catch (error) {
    /*
     * A provider that refused must not look like a call that broke. Nothing on
     * this screen is load-bearing — a call with no tips is a call — so the
     * stage comes back as a 200 with a reason, and the surface falls back to
     * the briefing rather than showing the operator an error mid-sentence.
     */
    if (error instanceof AssistantError) {
      return Response.json({ tip: null, unavailable: error.message })
    }
    return errorResponse(error)
  } finally {
    deadline.release()
  }
}
