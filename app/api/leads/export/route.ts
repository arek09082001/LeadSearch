import { errorResponse, requireSession } from '@/lib/api/guard'
import {
  CSV_DIALECTS,
  csvField,
  csvFilename,
  csvHeader,
  csvLine,
  isCsvDialect,
  type CsvDialect,
} from '@/lib/leads/csv'
import { today } from '@/lib/leads/dates'
import { coldFilters, dueFilters, parseFilters } from '@/lib/leads/filters'
import { EXPORT_LIMIT, leadPages } from '@/lib/leads/repository'
import type { LeadFilters } from '@/lib/leads/types'

/*
 * The export.
 *
 * A GET, and a link rather than a fetch, so the browser's own download machinery
 * does the work — no blob assembled in memory, no object URL to revoke, and a
 * file that keeps arriving if he switches tabs.
 *
 * It takes THE SAME query string the library page takes, parsed by the same
 * `parseFilters`. That is the whole design: the export cannot disagree with what
 * was on screen, because there is one parse of one URL and both surfaces read
 * it. The two Outreach queues arrive the same way, as `?queue=due` and
 * `?queue=cold`, because those queues have never been anything but filter sets.
 *
 * Streamed rather than assembled. Four thousand leads is a few megabytes of
 * text; building that as one string to hand to `Response` would hold all of it
 * in the function's memory and send nothing until the last row was read.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Which set of rows, and what to call the file. */
function resolve(url: URL): { filters: LeadFilters; what: string } {
  switch (url.searchParams.get('queue')) {
    case 'due':
      return { filters: dueFilters(), what: 'due' }
    case 'cold':
      return { filters: coldFilters(), what: 'cold' }
    default: {
      const filters = parseFilters(url.searchParams)
      return { filters, what: filters.deleted ? 'deleted' : 'book' }
    }
  }
}

export async function GET(request: Request) {
  try {
    await requireSession()

    const url = new URL(request.url)
    const { filters, what } = resolve(url)

    const key: CsvDialect = isCsvDialect(url.searchParams.get('sep'))
      ? (url.searchParams.get('sep') as CsvDialect)
      : 'excel'
    const dialect = CSV_DIALECTS[key]

    // Page 1 always: an export is the whole filtered set, and exporting page 7
    // of it because that is where he happened to be would be a trap.
    const pages = leadPages({ ...filters, page: 1 })
    const encoder = new TextEncoder()

    let started = false
    let written = 0

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!started) {
            started = true
            controller.enqueue(encoder.encode(`${csvHeader(dialect)}\r\n`))
          }

          const next = await pages.next()
          if (next.done) {
            /*
             * The ceiling, stated in the file rather than left to be noticed.
             * A truncated export that looks complete is exactly the kind of
             * thing that gets read out on a call, so the last row says so.
             */
            if (written >= EXPORT_LIMIT) {
              controller.enqueue(
                encoder.encode(
                  `${csvField(
                    `Stopped at ${EXPORT_LIMIT} rows. Narrow the view and export again.`,
                    dialect.delimiter,
                  )}\r\n`,
                ),
              )
            }
            controller.close()
            return
          }

          const chunk = next.value.map((lead) => csvLine(lead, dialect)).join('\r\n')
          written += next.value.length
          controller.enqueue(encoder.encode(`${chunk}\r\n`))
        } catch (error) {
          controller.error(error)
        }
      },
      cancel() {
        // He closed the tab or hit stop. Let the generator go rather than
        // paging through four thousand rows nobody is reading.
        void pages.return()
      },
    })

    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename(what, today())}"`,
        // A filtered export is a snapshot of a live book. Nothing about it
        // should survive in a cache to be handed back tomorrow.
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
