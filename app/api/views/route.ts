import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { parseFilters } from '@/lib/leads/filters'
import { createView, readViews } from '@/lib/leads/views'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireSession()
    return Response.json({ views: await readViews() })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    await requireSession()
    const body = (await readJson(request)) as Record<string, unknown>

    const name = typeof body.name === 'string' ? body.name : ''
    if (!name.trim()) return Response.json({ error: 'A view needs a name.' }, { status: 400 })

    // The client sends the query string it is currently looking at, which is
    // the whole of the filter state. Nothing else has to be kept in step.
    const query = typeof body.filters === 'string' ? body.filters : ''
    const filters = parseFilters(new URLSearchParams(query))

    return Response.json(await createView(name, filters))
  } catch (error) {
    return errorResponse(error)
  }
}
