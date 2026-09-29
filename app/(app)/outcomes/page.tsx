import type { Metadata } from 'next'

import { OutcomesConsole } from '@/components/outcomes/outcomes-console'
import { readOutcomes } from '@/lib/insight/store'

/*
 * Did the weights turn out to be right.
 *
 * A server component reading the store directly, like the queue and the book.
 * Nothing is cached: the answer changes the moment a call is logged, and a page
 * about how much evidence there is must never be served from a copy that has
 * less of it than the book does.
 *
 * It is a read and only a read. There is no route under /api for this and no
 * action on the page — see the note at the foot of the console for why the
 * decision it informs is deliberately made somewhere else.
 */

export const metadata: Metadata = { title: 'Outcomes — Lead Engine' }
export const dynamic = 'force-dynamic'

export default async function OutcomesPage() {
  const report = await readOutcomes()

  return (
    <>
      {/* Not drawn, for the reason the library's is not. See that page. */}
      <h1 className="sr-only">Outcomes — which diagnosis actually sells</h1>
      <OutcomesConsole report={report} />
    </>
  )
}
