import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { SearchConsole } from '@/components/search/search-console'
import { ErrorState } from '@/components/ui/states'
import { getBudgetState } from '@/lib/search/cost'

export const metadata: Metadata = { title: 'Search — Lead Engine' }

/*
 * Server component: it reads the budget straight through lib/ and hands it to
 * the console as initial state. The alternative — letting the client fetch it
 * on mount — would paint a search bar with no ceiling beside it, and the
 * ceiling is the one number that has to be true before the first search runs.
 */
export const dynamic = 'force-dynamic'

export default async function SearchPage() {
  // The layout gates this already, and so does proxy.ts. Repeated here because
  // this component reads data, and every surface that touches data checks first.
  const session = await auth()
  if (!session?.user?.email) redirect('/login')

  // Resolved to a value before any JSX exists: constructing an element inside a
  // try/catch puts the render itself inside the handler, which is not what the
  // recovery is for.
  const budget = await getBudgetState().then(
    (value) => ({ ok: true, value }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  )

  if (!budget.ok) {
    /*
     * Almost always a missing env var or an unapplied migration. Naming the
     * recovery beats a blank surface — the operator here is also the developer.
     */
    return (
      <ErrorState
        headline="Search unavailable"
        body="The API usage ledger could not be read, so the spending ceiling cannot be enforced — and no search runs without it. Check SUPABASE_URL and SUPABASE_SECRET_KEY, then make sure the migrations in supabase/migrations have been applied."
        detail={budget.error instanceof Error ? budget.error.message : String(budget.error)}
      />
    )
  }

  return <SearchConsole initialBudget={budget.value} />
}
