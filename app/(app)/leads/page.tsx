import type { Metadata } from 'next'

import { StatusStrip } from '@/components/shell/status-strip'
import { EmptyState } from '@/components/ui/states'
import { CommandLink } from '@/components/ui/command-button'

export const metadata: Metadata = { title: 'Leads — Lead Engine' }

export default function LeadsPage() {
  return (
    <>
      <StatusStrip provenance="book" detail="0 records" />
      <EmptyState
        headline="The book is empty"
        body="Saved leads live here — your audit findings, your score, your notes, your outreach status. Nothing arrives automatically; a lead is here because you put it here."
        action={
          <CommandLink href="/search" variant="primary">Go to search</CommandLink>
        }
      />
    </>
  )
}
