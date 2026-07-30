import type { Metadata } from 'next'

import { StatusStrip } from '@/components/shell/status-strip'
import { EmptyState } from '@/components/ui/states'
import { CommandLink } from '@/components/ui/command-button'

export const metadata: Metadata = { title: 'Outreach — Lead Engine' }

export default function OutreachPage() {
  return (
    <>
      <StatusStrip provenance="book" detail="0 due · 0 cold" />
      <EmptyState
        headline="Nothing queued"
        body="Leads you have contacted show up here when they are due for a follow-up, or when they have gone quiet long enough to call cold. Save a lead first."
        action={
          <CommandLink href="/leads" variant="primary">Go to the book</CommandLink>
        }
      />
    </>
  )
}
