'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { CommandButton } from '@/components/ui/command-button'

/*
 * The control that turns a diagnosis into an opening line.
 *
 * It sits in the status strip beside Refresh and Re-audit, which is where the
 * three things the operator can DO to a lead already live. Preparing is the
 * third of them and the only one he presses with a phone already in his other
 * hand, so it is the primary variant — the one amber control on the strip.
 *
 * Re-preparing is deliberately allowed at any time and is not guarded behind a
 * confirmation. With the fixture provider it costs nothing at all, and the
 * review fetch behind it is cached for thirty days, so the second press inside a
 * month is free. What it does cost is a row, and rows are the point: a briefing
 * is append-only because what was said last time is worth keeping.
 */
export function PrepareCall({ leadId, prepared }: { leadId: string; prepared: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function prepare() {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    setNote(null)

    try {
      const response = await fetch('/api/calls/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      const body = (await response.json()) as { reviewsError?: string | null; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'The briefing could not be prepared.')

      /*
       * A briefing written without reviews is still a briefing, so this is a
       * note rather than an error — but it is said, because the operator is
       * about to read a sheet that is quieter than it should be and he should
       * know why.
       */
      if (body.reviewsError) setNote(`Written without reviews. ${body.reviewsError}`)

      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The briefing could not be prepared.')
    } finally {
      setRunning(false)
      inFlight.current = false
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error ? (
        <span className="label text-alert" role="status">
          {error}
        </span>
      ) : note ? (
        <span className="label text-ink-faint" role="status">
          {note}
        </span>
      ) : null}
      <CommandButton variant="primary" onClick={prepare} disabled={running}>
        {running ? 'Preparing' : prepared ? 'Prepare again' : 'Prepare call'}
      </CommandButton>
    </span>
  )
}

/**
 * Print the briefing, and only the briefing.
 *
 * A one-line client component rather than a link to a print route: the sheet is
 * already on screen, the print stylesheet in globals.css hides everything
 * around it, and a second route rendering the same thing would be a second
 * place for it to drift. Hidden from the printed page itself for the obvious
 * reason.
 */
export function PrintBriefing() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="label text-ink-faint transition-colors hover:text-signal print:hidden"
    >
      Print
    </button>
  )
}
