/*
 * The provenance strip.
 *
 * This is where the product's central split becomes visible: a LIVE surface is
 * showing volatile Google data that expires, a BOOK surface is showing the
 * operator's own permanent records. The strip states which, and how old.
 * Principle 5 — stale data must admit it — lives here.
 */

export type Provenance = 'live' | 'book'

const PROVENANCE = {
  live: {
    label: 'Live',
    dot: 'bg-live',
    note: 'Transient — from Google Places, expires automatically.',
  },
  book: {
    label: 'Book',
    dot: 'bg-signal',
    note: 'Permanent — saved by you, kept indefinitely.',
  },
} as const

export function StatusStrip({
  provenance,
  detail,
  children,
}: {
  provenance: Provenance
  /** Age or fetch stamp. Omitted only when there is genuinely nothing to date. */
  detail?: string
  children?: React.ReactNode
}) {
  const meta = PROVENANCE[provenance]

  return (
    <div className="flex items-center gap-2 border-b border-rule bg-panel px-2 py-1.5 md:gap-3 md:px-3">
      <span className="flex shrink-0 items-center gap-1.5">
        <span aria-hidden="true" className={`size-1.5 ${meta.dot}`} />
        <span className="label text-ink-dim">{meta.label}</span>
      </span>

      <span aria-hidden="true" className="hidden h-3 w-px bg-rule-strong md:block" />

      {/* The dot and label already carry the distinction; the sentence is the
          explanation, and it is the first thing a narrow strip can spare. */}
      <span className="hidden truncate text-sm text-ink-faint md:inline">{meta.note}</span>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {children}
        {detail ? <span className="font-data text-micro text-ink-faint">{detail}</span> : null}
      </div>
    </div>
  )
}
