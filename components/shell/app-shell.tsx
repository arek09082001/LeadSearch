import { Masthead } from '@/components/shell/masthead'

/*
 * The frame. Content fills the viewport edge to edge — no centred max-width
 * column, because every horizontal pixel is a column of data the operator wants.
 *
 * THE FRAME IS THE VIEWPORT, and the surface scrolls inside it.
 *
 * `h-dvh` and not `min-h-dvh`, which is the difference between a page that is
 * at least a screen tall and one that is exactly a screen tall. The tables did
 * not care — a document that grows and scrolls is what a table wants. The map
 * cares completely: a field is only worth what is left of the screen after the
 * bands above it, and with an "at least" frame there is no such thing as what
 * is left. Every height below it is then indefinite, `flex-1` cannot take space
 * away from a list of sixty rows, and the surface's own results push the
 * instrument off the bottom of the screen. That was not a styling slip on one
 * component; it was the frame declining to have a size.
 *
 * So the height is stated once, here, and `main` is what scrolls. Everything
 * else is unchanged: the masthead was already sticky and stays exactly where it
 * was, a long table still scrolls under it, and a sticky table header now
 * settles against the masthead instead of underneath it.
 */
export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
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
      {/*
        `min-h-0` is the half of this that is easy to leave out and impossible
        to work around: without it a flex child refuses to be smaller than its
        contents, and the scroll never happens here — it happens to the page.
      */}
      <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
