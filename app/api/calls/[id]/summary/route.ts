import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { markSummaryAccepted, readCall, readLatestSummary, stampHandover } from '@/lib/assistant/store'
import { summariseCall, summariseCallOnce } from '@/lib/assistant/summarise'
import { Deadline } from '@/lib/deadline'
import { LEAD_STATUSES, type LeadStatus } from '@/lib/leads/types'

/*
 * What is left when the line drops, and what the operator does with it.
 *
 * POST WRITES THE SUMMARY. PATCH RECORDS WHAT HE TOOK FROM IT. Those are two
 * different acts by two different authors and the split is the point of this
 * file: one is the assistant speaking, the other is the operator answering, and
 * nothing on this route lets the first do the second's job.
 *
 * FIRED BY THE STOP BUTTON, NOT BY LEAVING THE PAGE. A closed tab, a route
 * change, a laptop lid — none of those generate anything. The reasoning is not
 * about cost: a summary written because a tab was navigated away from is a
 * summary nobody is looking at, and it lands in `call_summaries` with `accepted`
 * null forever, which is the state that means "he has not looked yet". Enough of
 * those and the one number this table exists to produce stops meaning anything.
 *
 * IT RACES A DELETION IT CANNOT POSTPONE. `call_transcript_segments` expires
 * after fourteen days, inside Postgres, whether or not this app is running. So
 * the summary has to be written while the words are there, and when they are
 * not, this route says so — `reason` comes back instead of a body, and no
 * provider is asked. See `summarise.ts` for why that refusal is the load-bearing
 * behaviour rather than an edge case.
 *
 * THE OPERATOR'S ACT REACHES THE LEAD THROUGH THE ROUTE THAT ALREADY MOVES
 * LEADS. Nothing here writes `leads.status`, `leads.follow_up_at` or a note:
 * that is `PATCH /api/leads/[id]`, which does all three in one request and whose
 * trigger already logs the transition into `lead_activities`. What this route
 * writes is the record of the same press against the CALL — `accepted`,
 * `outcome`, `status_after` — because those three columns are what make the
 * question "which conversation moved which lead where" answerable later, and
 * they had been sitting empty since the calls table was created.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/*
 * Long enough for one generation and no longer. The operator has just hung up
 * and is looking at the screen; a request still running after a minute has lost
 * him, and the transcript is safely stored either way.
 *
 * The same generation the briefing route makes, by the same model with the same
 * thinking on — so it had the same defect and gets the same fix: half a minute
 * was not reliably enough for it, and a request that ran over was killed by the
 * platform rather than answered. `BUDGET_MS` holds the work a few seconds inside
 * the limit so that running out of time arrives as a sentence.
 */
export const maxDuration = 60

/** What the work gets, out of the sixty. The rest is writing the row and the reply. */
const BUDGET_MS = 55_000

type Context = { params: Promise<{ id: string }> }

/**
 * The bound on a stored summary body.
 *
 * The same kind of bound the tips route applies and for the same reason: not a
 * layout rule — this is prose and prose is allowed to be a paragraph — but a
 * limit on what could only have come from something malfunctioning. A provider
 * that returned the whole transcript would otherwise put the call's verbatim
 * words into the one table that outlives the fourteen days.
 */
const MAX_BODY = 4_000

export async function POST(request: Request, { params }: Context) {
  const deadline = Deadline.in(BUDGET_MS, 'Writing up the call')

  try {
    await requireSession()
    const { id } = await params

    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })

    /*
     * Regenerating is asked for, never fallen into. The default press — the one
     * the Stop button makes — returns whatever is already there, so a retried
     * request or a double-click costs nothing and cannot produce two paragraphs
     * about the same conversation. `call_summaries` allows several rows per call
     * on purpose, and this is the flag that spends that allowance.
     */
    const body = (await readJson(request).catch(() => ({}))) as { regenerate?: unknown }
    // Raced for the reason the prepare route races: a leg that does not honour
    // the signal must not be able to hold the response past the deadline.
    const result = await Promise.race([
      body.regenerate === true ? summariseCall(id, deadline) : summariseCallOnce(id, deadline),
      deadline.rejected(),
    ])

    if (!result.summary) {
      // Not an error. There is no transcript to write up, the route says which
      // kind of nothing that is, and the surface says it in words.
      return Response.json({ summary: null, reason: result.reason })
    }

    return Response.json({
      summary: { ...result.summary, body: result.summary.body.slice(0, MAX_BODY) },
      reason: null,
    })
  } catch (error) {
    return errorResponse(error)
  } finally {
    deadline.release()
  }
}

/**
 * What he took, and how the call is filed.
 *
 * Three fields, all optional, all his:
 *
 *   `accepted`    — true the first time he takes any part of the summary, false
 *                   when he looks and takes none of it. Null stays null until
 *                   one of those happens, which is what "not looked at yet"
 *                   means and why the column has no default.
 *   `outcome`     — free text, his own shorthand, from the open list in the
 *                   vocabulary. Never derived from the suggestion: a status the
 *                   assistant proposed is not the operator saying how the call
 *                   went.
 *   `statusAfter` — where the lead ended up. Sent by the surface only when it
 *                   has just moved the lead through the leads route, so this
 *                   column records a move that actually happened.
 *
 * The lead itself is untouched here. See the note at the top of the file.
 */
export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params

    const body = (await readJson(request)) as {
      accepted?: unknown
      outcome?: unknown
      statusAfter?: unknown
    }

    if (
      body.statusAfter !== undefined &&
      !LEAD_STATUSES.includes(body.statusAfter as LeadStatus)
    ) {
      return Response.json({ error: 'That is not a status this product has.' }, { status: 400 })
    }

    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })

    await stampHandover(id, {
      outcome:
        typeof body.outcome === 'string' && body.outcome.trim() ? body.outcome.trim() : undefined,
      statusAfter: body.statusAfter as LeadStatus | undefined,
    })

    if (typeof body.accepted === 'boolean') {
      const summary = await readLatestSummary(id)
      /*
       * Silently ignored rather than refused. A verdict on a summary that is not
       * there is a stale tab pressing a button, and there is nothing for the
       * operator to do about it — the outcome above has already been written,
       * which is the part of this request that was about the call rather than
       * about a row.
       */
      if (summary) await markSummaryAccepted(id, summary.id, body.accepted)
    }

    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
