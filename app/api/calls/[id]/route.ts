import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { endCall, readCall, setConsentNoted } from '@/lib/assistant/store'

/*
 * One call: what the operator did to it, and when it ended.
 *
 * Two fields, and they are here together because they are the two things he
 * touches during a call that are not speech. Everything about the transcript
 * lives on the routes beside this one.
 *
 * `consentNoted` IS A RECORD, NOT A GATE, and the schema says so in as many
 * words: it is whether he stated that the call is being transcribed, written
 * down because he said it. It does not unlock the start button. The surface puts
 * the line above the button where it will be read, the assistant's
 * `consent_not_noted` trigger exists to say so out loud if the box is still
 * unticked a minute in, and neither of those is a lock — an operator who has
 * just been asked "who is this?" needs to answer the question, not find a
 * checkbox first.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params
    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })
    return Response.json(call)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params
    const body = (await readJson(request)) as Record<string, unknown>

    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })

    if (typeof body.consentNoted === 'boolean') {
      await setConsentNoted(id, body.consentNoted)
    }

    if (body.ended === true) {
      // Free text by design — `calls.outcome` is text and the vocabulary in
      // lib/assistant/vocabulary.ts is a list of suggestions, not a closed set.
      const outcome =
        typeof body.outcome === 'string' && body.outcome.trim() ? body.outcome.trim() : null
      return Response.json(await endCall(id, outcome))
    }

    const updated = await readCall(id)
    return Response.json(updated)
  } catch (error) {
    return errorResponse(error)
  }
}
