
import { CommandLink } from '@/components/ui/command-button'
import { EmptyState } from '@/components/ui/states'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="border-b border-rule px-3 py-2">
        <span className="label text-ink">Lead Engine</span>
      </header>
      <EmptyState
        headline="No such surface"
        body="That address does not exist in this instance. The session has three: search, the book, and outreach."
        action={
          <CommandLink href="/search" variant="primary">Back to search</CommandLink>
        }
      />
    </div>
  )
}
