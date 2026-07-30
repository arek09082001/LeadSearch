import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { parseFilters } from '@/lib/leads/filters'
import { deleteView, renameView, touchView, updateView } from '@/lib/leads/views'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * Rename it, overwrite its filters, or mark it used.
 *
 * Three verbs on one route because they are the same edit to the operator —
 * "this view, but different" — and splitting them would mean three fetch
 * helpers on the client for one dropdown menu.
 */
export async function PATCH(request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params
    const body = (await readJson(request)) as Record<string, unknown>

    if (typeof body.name === 'string') {
      await renameView(id, body.name)
    }
    if (typeof body.filters === 'string') {
      await updateView(id, parseFilters(new URLSearchParams(body.filters)))
    }
    if (body.used === true) {
      await touchView(id)
    }

    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params
    await deleteView(id)
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
