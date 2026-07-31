import { Masthead } from '@/components/shell/masthead'

/*
 * The frame. Content fills the viewport edge to edge — no centred max-width
 * column, because every horizontal pixel is a column of data the operator wants.
 */
export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        The `id="main"` below has been waiting for something to point at it.
        Every surface here is a hundred-row table under a masthead and a filter
        bar; a keyboard-first product that makes you tab past all of it to reach
        the rows is keyboard-first in name only.

        Invisible until focused, then a ruled block in the corner in the
        system's own grammar — not an off-screen link that reads as a rendering
        bug when it appears.
      */}
      <a
        href="#main"
        className="label sr-only bg-panel px-3 py-2 text-signal focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-signal"
      >
        Skip to content
      </a>

      <Masthead email={email} />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  )
}
