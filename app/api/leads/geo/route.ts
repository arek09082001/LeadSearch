import { errorResponse, requireSession } from '@/lib/api/guard'
import { parseBounds } from '@/lib/leads/bounds'
import { parseFilters } from '@/lib/leads/filters'
import { queryLeadPoints } from '@/lib/leads/repository'

/*
 * The library, inside a box.
 *
 * It takes THE SAME query string the library page and the export take, parsed by
 * the same `parseFilters`, plus four numbers saying where the map is pointing.
 * That is the whole design, and it is the export's design restated: there is one
 * parse of one URL, so the map cannot show a pin the table would have hidden and
 * the two cannot drift as filters are added.
 *
 *   GET /api/leads/geo?north=49.2&south=49.1&east=9.3&west=9.1&status=new&audit=no_website
 *
 * The payload is points, not rows — id, coordinates, name, score, status and the
 * audit marks. A map draws dots; what is behind a dot is what the detail route
 * has always been for, and clicking one is a navigation the operator already
 * knows how to make.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireSession()

    const params = new URL(request.url).searchParams
    const bounds = parseBounds(params)
    // A box that could not be read is a 400 with a sentence, never an empty
    // result: a map with no pins on it looks like a book with nothing in it.
    if ('error' in bounds) {
      return Response.json({ error: bounds.error }, { status: 400 })
    }

    return Response.json(await queryLeadPoints(parseFilters(params), bounds))
  } catch (error) {
    return errorResponse(error)
  }
}
