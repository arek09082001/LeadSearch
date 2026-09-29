'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { IconSync } from '@/components/icons'
import { CommandButton } from '@/components/ui/command-button'
import { ago } from '@/lib/leads/dates'

/*
 * Ask Google about this one business, now.
 *
 * The manual half of the refresh. The scheduled pass keeps the book roughly
 * current on its own cadence; this is for the moment before a call, when the
 * operator wants to know that the number he is about to dial and the "no
 * website" he is about to open with are still true.
 *
 * IT SPENDS MONEY, which is why it is a deliberate button with the cost stated
 * beside it rather than something that happens on page load. One billable Place
 * Details request, against the same monthly ceiling the search runs under — and
 * if that ceiling refuses, the answer says so rather than failing silently.
 *
 * Unlike `ReAudit`, this does not poll. A refresh is one request that either
 * answers or does not; there is no queue behind it to keep nudging.
 */
export function RefreshLead({
  leadId,
  /** When the Google half of this lead was last fetched. Principle 5, on the control itself. */
  fetchedAt,
}: {
  leadId: string
  fetchedAt: string
}) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)

  async function refresh() {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setMessage(null)
    setFailed(false)

    try {
      const response = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: [leadId] }),
      })
      const body = (await response.json()) as {
        changed?: number
        failed?: number
        reAudited?: number
        stoppedBy?: string | null
        error?: string
      }
      if (!response.ok) throw new Error(body.error ?? 'Google could not be reached.')

      if (body.stoppedBy) {
        setFailed(true)
        setMessage(body.stoppedBy)
      } else if (body.failed) {
        setFailed(true)
        setMessage('Google could not be reached. The details on file are unchanged.')
      } else if (body.changed) {
        setMessage(
          body.reAudited
            ? 'Something changed — re-auditing, and the score will follow.'
            : 'Something changed. It is in the history below.',
        )
      } else {
        setMessage('Nothing has changed.')
      }

      router.refresh()
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : 'Google could not be reached.')
    } finally {
      setRunning(false)
      inFlight.current = false
    }
  }

  return (
    <span className="flex items-center gap-2">
      {message ? (
        <span
          role="status"
          className={`hidden text-sm md:inline ${failed ? 'text-alert' : 'text-ink-faint'}`}
        >
          {message}
        </span>
      ) : null}

      <CommandButton
        onClick={refresh}
        disabled={running}
        title={`Google data is from ${ago(fetchedAt)}. Asking again costs one billable request.`}
      >
        <IconSync className={`size-3.5 ${running ? 'animate-pulse' : ''}`} />
        {running ? 'Asking Google' : 'Refresh'}
      </CommandButton>
    </span>
  )
}
