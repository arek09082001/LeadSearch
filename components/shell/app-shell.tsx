import { Masthead } from '@/components/shell/masthead'

/*
 * The frame. Content fills the viewport edge to edge — no centred max-width
 * column, because every horizontal pixel is a column of data the operator wants.
 */
export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Masthead email={email} />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  )
}
