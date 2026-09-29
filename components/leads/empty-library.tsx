import { IconBook } from '@/components/icons'
import { CommandLink } from '@/components/ui/command-button'

/*
 * The first thing the operator ever sees on this surface.
 *
 * PRODUCT.md's brief was explicit that it should teach rather than announce, so
 * it describes the loop the product is built around rather than reporting a
 * count of zero. The three steps are the actual session shape from
 * PRODUCT.md — search, save, work the book — with the product's central rule
 * stated where it will be read: nothing arrives here on its own.
 *
 * Ruled steps, not cards. Same field, same scale, no chrome.
 */

const STEPS = [
  {
    n: '01',
    title: 'Run a search',
    body: 'Pick an area and a category. Results come live from Google Places, and they are transient — they expire on their own and cost money to fetch again.',
  },
  {
    n: '02',
    title: 'Tick the ones worth keeping',
    body: 'Sort by Website to bring the businesses with no site to the top, tick them, and save the selection. You can file them under a list and attach a note as you go.',
  },
  {
    n: '03',
    title: 'Work them here',
    body: 'Saved leads are yours permanently. Each one gets audited in the background, and this is where you filter, set status, schedule follow-ups and come back to them weeks later.',
  },
]

export function EmptyLibrary() {
  return (
    <div className="flex flex-1 items-start justify-center px-6 py-12">
      <div className="w-full max-w-[62ch]">
        <div className="flex items-center gap-2 text-signal">
          <IconBook className="size-4 shrink-0" />
          <h2 className="label">The book is empty</h2>
        </div>

        <p className="mt-2 max-w-[52ch] text-sm text-ink-dim">
          Nothing arrives here automatically. A lead is in the book because you
          put it there — and once it is, it stays: your audit, your notes, your
          status, for as long as you want it.
        </p>

        <ol className="mt-6 divide-y divide-rule border-y border-rule">
          {STEPS.map((step) => (
            <li key={step.n} className="flex gap-4 py-3">
              <span
                aria-hidden="true"
                className="shrink-0 font-data text-micro text-ink-ghost"
              >
                {step.n}
              </span>
              <div className="min-w-0">
                <h3 className="label text-ink">{step.title}</h3>
                <p className="mt-1 max-w-[52ch] text-sm text-ink-dim">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex items-center gap-2">
          <CommandLink href="/search" variant="primary" keyHint="Alt+1">
            Run your first search
          </CommandLink>
        </div>
      </div>
    </div>
  )
}

/**
 * The other empty: a library with records, filtered down to none.
 *
 * A different message on purpose. "The book is empty" would be a lie here, and
 * the recovery is not "go and search" but "you have over-filtered" — telling
 * him the wrong one costs a wasted trip to the search page.
 */
export function EmptyResult({
  onClear,
  libraryTotal,
  deletedView,
}: {
  onClear: () => void
  libraryTotal: number
  deletedView: boolean
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[46ch]">
        <div aria-hidden="true" className="mb-4 flex w-16 flex-col gap-[3px]">
          <span className="border-t border-dashed border-ink-ghost" />
          <span className="border-t border-dashed border-ink-ghost" />
          <span className="border-t border-dashed border-ink-ghost" />
        </div>

        <h2 className="text-lg font-semibold text-ink">
          {deletedView ? 'Nothing deleted' : 'No lead matches these filters'}
        </h2>
        <p className="mt-1.5 text-sm text-ink-dim">
          {deletedView
            ? 'Deleted leads wait here for thirty days before they are removed for good. Nothing is waiting.'
            : `The book holds ${libraryTotal.toLocaleString('de-DE')} lead${
                libraryTotal === 1 ? '' : 's'
              } — none of them match what you have narrowed to.`}
        </p>

        {!deletedView ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="label border border-signal px-2.5 py-1.5 text-signal transition-colors hover:bg-signal hover:text-ground"
            >
              Clear filters
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
