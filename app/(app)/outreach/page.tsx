import type { Metadata } from 'next'

import { OutreachConsole } from '@/components/outreach/outreach-console'
import { readOutreachQueues } from '@/lib/leads/repository'

/*
 * The follow-up queue: who is due, and who is worth ringing cold.
 *
 * A server component reading the repository directly, like the book. The two
 * queues are computed rather than filtered — they are the third surface
 * PRODUCT.md names, and what belongs in them was the operator's decision, not
 * something this page is free to reinterpret. See COLD_SCORE_FLOOR for the one
 * number it turns on.
 */

export const metadata: Metadata = { title: 'Outreach — Lead Engine' }

// Request-time and unshared, as everywhere else: there is one user, and a
// cached queue would tell him to ring somebody he rang an hour ago.
export const dynamic = 'force-dynamic'

export default async function OutreachPage() {
  const queues = await readOutreachQueues()
  return <OutreachConsole queues={queues} />
}
