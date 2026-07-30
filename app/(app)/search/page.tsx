import type { Metadata } from 'next'

import { StatusStrip } from '@/components/shell/status-strip'
import { EmptyState } from '@/components/ui/states'
import { CommandButton } from '@/components/ui/command-button'

export const metadata: Metadata = { title: 'Search — Lead Engine' }

export default function SearchPage() {
  return (
    <>
      <StatusStrip provenance="live" detail="No fetch this session" />
      <EmptyState
        headline="No search run yet"
        body="Search an area and a category to pull businesses from Google Places. Results are transient — they expire on their own, and nothing is kept unless you save it."
        action={
          <CommandButton variant="primary" disabled>
            Run a search
          </CommandButton>
        }
      />
    </>
  )
}
