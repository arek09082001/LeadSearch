import type { Metadata } from 'next'

import { LeadsConsole } from '@/components/leads/leads-console'
import { countPending } from '@/lib/enrichment/run'
import { parseFilters } from '@/lib/leads/filters'
import { queryLeads, readFacets, readLists } from '@/lib/leads/repository'
import { readViews } from '@/lib/leads/views'

/*
 * The library. Per PRODUCT.md this is where the operator lives, not the search
 * page — so it is a server component that reads the repository directly and
 * hands the client everything it needs in one payload.
 *
 * The filter state is the URL and the URL alone. That is what makes a filtered
 * library a bookmark, makes the back button step through his filtering, and
 * makes a saved view nothing more exotic than a stored query string. Filters
 * are parsed here and passed down as a prop rather than re-read on the client,
 * so both halves are looking at one parse of one URL.
 */

export const metadata: Metadata = { title: 'Leads — Lead Engine' }

// Every read here is request-time and unshared: there is one user, and a cached
// library would show him his own writes late.
export const dynamic = 'force-dynamic'

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const filters = parseFilters(await searchParams)

  const [listing, facets, views, lists, pendingAudits] = await Promise.all([
    queryLeads(filters),
    readFacets(),
    readViews(),
    readLists(),
    countPending(),
  ])

  return (
    <LeadsConsole
      filters={filters}
      listing={listing}
      facets={facets}
      views={views}
      lists={lists}
      pendingAudits={pendingAudits}
    />
  )
}
