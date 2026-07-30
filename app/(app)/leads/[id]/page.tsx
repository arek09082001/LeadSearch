import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { LeadDiagnosis } from '@/components/leads/lead-diagnosis'
import { readLead, readLeadDetail } from '@/lib/leads/repository'

/*
 * One lead's page: the diagnosis, and the evidence for it.
 *
 * A server component reading the repository directly, like the book it came
 * from. Everything on it is the operator's own permanent work product — the
 * audit, its findings, its history — so nothing here expires; only the Google
 * snapshot in the header carries an age, and the strip states it.
 */

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const lead = await readLead(id)
  // The business name in the tab, because he works with several open at once
  // and "Lead — Lead Engine" four times over is not a way to find one.
  return { title: lead ? `${lead.name} — Lead Engine` : 'Lead — Lead Engine' }
}

export default async function LeadPage({ params }: Props) {
  const { id } = await params
  const detail = await readLeadDetail(id)
  if (!detail) notFound()

  return <LeadDiagnosis detail={detail} />
}
