import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { ensureList, readLists } from '@/lib/leads/repository'

/*
 * Lists, which are also tags.
 *
 * One vocabulary rather than two: a "list" and a "tag" would be the same table
 * with the same join and a different word, and the operator would have to
 * remember which of his groupings he made under which name.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireSession()
    return Response.json({ lists: await readLists() })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    await requireSession()
    const body = (await readJson(request)) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name : ''
    if (!name.trim()) return Response.json({ error: 'A list needs a name.' }, { status: 400 })
    // ensureList is find-or-create, so naming an existing list is not an error.
    return Response.json(await ensureList(name))
  } catch (error) {
    return errorResponse(error)
  }
}
