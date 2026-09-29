import type { Metadata } from 'next'

import { OutreachConsole } from '@/components/outreach/outreach-console'
import { readOutreach } from '@/lib/leads/repository'

/*
 * The queue.
 *
 * A server component reading the repository directly, like the book it is two
 * questions about. Nothing is cached: "due" is answered against today's date
 * and the operator is the only reader, so a queue served from a cache would be
 * a queue that still lists the lead he just worked.
 */

export const metadata: Metadata = { title: 'Outreach — Lead Engine' }
export const dynamic = 'force-dynamic'

export default async function OutreachPage() {
  const { due, cold } = await readOutreach()
  return (
    <>
      {/* Not drawn, for the reason the library's is not. See that page. */}
      <h1 className="sr-only">Outreach — who is due and who has gone cold</h1>
      <OutreachConsole due={due} cold={cold} />
    </>
  )
}
