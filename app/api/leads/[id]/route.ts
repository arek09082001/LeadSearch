import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { addNote, applyBulk, readLead, updateLead } from '@/lib/leads/repository'
import { LEAD_STATUSES, type LeadStatus } from '@/lib/leads/types'

/*
 * One lead. The row-level counterpart to the bulk route.
 *
 * DELETE is soft and returns the id it hid, so a single-row delete offers the
 * same undo the bulk one does. There is deliberately no hard delete here: the
 * purge job is the only thing that destroys a lead, and it does so on a clock
 * the operator can outrun.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Dynamic params are a promise in this version; awaiting is not optional.
type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params
    const lead = await readLead(id)
    if (!lead) return Response.json({ error: 'No such lead.' }, { status: 404 })
    return Response.json(lead)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params
    const body = (await readJson(request)) as Record<string, unknown>

    if (typeof body.status === 'string' && !LEAD_STATUSES.includes(body.status as LeadStatus)) {
      return Response.json({ error: 'That is not a status this product has.' }, { status: 400 })
    }
    if (
      body.followUpAt !== undefined &&
      body.followUpAt !== null &&
      (typeof body.followUpAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.followUpAt))
    ) {
      return Response.json({ error: 'A follow-up date must look like 2026-08-14.' }, { status: 400 })
    }

    await updateLead(id, {
      status: typeof body.status === 'string' ? (body.status as LeadStatus) : undefined,
      followUpAt: body.followUpAt === undefined ? undefined : (body.followUpAt as string | null),
    })

    // A note sent alongside a status change is one action to the operator, so
    // it is one request. The status trigger has already logged the transition.
    if (typeof body.note === 'string' && body.note.trim()) {
      await addNote(id, body.note)
    }

    return Response.json(await readLead(id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params
    return Response.json(await applyBulk([id], { action: 'delete' }))
  } catch (error) {
    return errorResponse(error)
  }
}
