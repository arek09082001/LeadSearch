import { IconAlert } from '@/components/icons'

/*
 * The three states every surface owes the operator before it owes him data.
 *
 * All three sit in the same ruled field as real content, at the same scale, so
 * an empty surface reads as "this instrument has no signal yet" rather than as
 * a different page. None of them is a card.
 */

/** Empty: a surface with nothing filed in it yet. Names the next action. */
export function EmptyState({
  headline,
  body,
  action,
}: {
  headline: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[46ch]">
        {/* Empty rules: the shape of the rows that are not there yet. */}
        <div aria-hidden="true" className="mb-4 flex w-16 flex-col gap-[3px]">
          <span className="border-t border-dashed border-ink-ghost" />
          <span className="border-t border-dashed border-ink-ghost" />
          <span className="border-t border-dashed border-ink-ghost" />
        </div>
        <h2 className="text-lg font-semibold text-ink">{headline}</h2>
        <p className="mt-1.5 text-sm text-ink-dim">{body}</p>
        {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}

/*
 * Loading: the shape of the data that is coming, ruled the same way. A terminal
 * does not spin — it shows the rows filling. Rows are already visible and fade
 * between two ground tones rather than sliding in.
 */
export function LoadingRows({ rows = 12, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex-1">
      <span className="sr-only">{label}</span>
      <div className="divide-y divide-rule border-b border-rule">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-3 py-2">
            <span
              className="h-2.5 animate-pulse bg-raise"
              style={{
                width: `${18 + ((i * 7) % 22)}%`,
                animationDelay: `${i * 45}ms`,
              }}
            />
            <span
              className="ml-auto h-2.5 w-16 animate-pulse bg-raise"
              style={{ animationDelay: `${i * 45 + 90}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Error: names the problem and the recovery, never just "something went wrong". */
export function ErrorState({
  headline,
  body,
  detail,
  action,
}: {
  headline: string
  body: string
  /** The raw message. Shown, because the operator is also the developer. */
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[52ch] border-l border-alert pl-4">
        <div className="flex items-center gap-2 text-alert">
          <IconAlert className="size-4 shrink-0" />
          <h2 className="label">{headline}</h2>
        </div>
        <p className="mt-2 text-sm text-ink-dim">{body}</p>
        {/* Wraps rather than scrolls: this is text to read, not a data column. */}
        {detail ? (
          <pre className="mt-3 border border-rule bg-panel px-2.5 py-2 font-data text-micro break-words whitespace-pre-wrap text-ink-faint">
            {detail}
          </pre>
        ) : null}
        {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}
