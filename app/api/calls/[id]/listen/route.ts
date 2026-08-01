import { errorResponse, requireSession } from '@/lib/api/guard'
import { markListening } from '@/lib/assistant/store'

/*
 * The moment the line opened.
 *
 * Its own route rather than a field on the PATCH below, because it is not an
 * edit to the call — it is the call's clock being set, and every segment written
 * afterwards is measured against what this returns. A caller that got it wrong
 * would not produce a wrong field; it would produce a transcript with the wrong
 * shape.
 *
 * The response is the timeline's zero, and the surface uses it rather than its
 * own `Date.now()`: the browser's clock and Postgres's clock disagree by however
 * much they disagree, and the one that `at_ms` is defined against is Postgres's.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params

    const { startedAt, restamped } = await markListening(id)

    // `restamped` is surfaced rather than swallowed: false means this call
    // already had a transcript, so the operator is resuming one rather than
    // starting one, and the surface says which.
    return Response.json({ startedAt, restamped })
  } catch (error) {
    return errorResponse(error)
  }
}
