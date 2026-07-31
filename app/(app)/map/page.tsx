import type { Metadata } from 'next'

import { MapConsole } from '@/components/map/map-console'
import { parseFilters } from '@/lib/leads/filters'
import { countLibrary, readFacets } from '@/lib/leads/repository'
import { readViews } from '@/lib/leads/views'
import { getBudgetState } from '@/lib/search/cost'

/*
 * The book, drawn as a field.
 *
 * A second representation of `/leads`, not a second source of truth: the filter
 * state is the URL and the URL alone, parsed here by the same `parseFilters` the
 * table and the export use, so a saved view applies to both surfaces and a
 * narrowed map is a bookmark like everything else.
 *
 * The pins themselves are NOT read here. `/api/leads/geo` answers a bounding box
 * and the client asks it again on every pan — a server render cannot know where
 * the map is pointing, and pushing every lead in the country into the first
 * payload to avoid one fetch would be a slower page that is also wrong the
 * moment it is dragged.
 */

export const metadata: Metadata = { title: 'Map — Lead Engine' }

// One user, request-time reads. A cached map would show him his own saves late.
export const dynamic = 'force-dynamic'

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const filters = parseFilters(await searchParams)

  /*
   * The budget is resolved to a value rather than thrown, unlike on the search
   * surface. There, an unreadable ledger means the whole page is useless — every
   * control on it spends money. Here it costs the operator the search panel and
   * nothing else: the map is his own book, out of his own database, and
   * replacing it with an error page over a ledger he was not using would be the
   * surface refusing to do the job it was opened for.
   */
  const [facets, views, libraryTotal, budget] = await Promise.all([
    readFacets(),
    readViews(),
    countLibrary(),
    getBudgetState().then(
      (value) => ({ ok: true, value }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    ),
  ])

  return (
    <>
      {/* Not drawn, for the reason the library's is not. See that page. */}
      <h1 className="sr-only">Map — the library as a field, and search by point</h1>

      <MapConsole
        filters={filters}
        facets={facets}
        views={views}
        libraryTotal={libraryTotal}
        initialBudget={budget.ok ? budget.value : null}
        budgetError={
          budget.ok
            ? null
            : budget.error instanceof Error
              ? budget.error.message
              : String(budget.error)
        }
      />
    </>
  )
}
