'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { CommandButton } from '@/components/ui/command-button'

/*
 * Run the audit again, and watch it happen.
 *
 * Audits are re-runnable and keep history — a site that was dead in March and
 * answers in July is the whole reason for keeping the old rows — so this is a
 * first-class control rather than something buried in a bulk menu.
 *
 * It also owns the poll for this one lead, for the same reason the book does:
 * a pass runs in slices bounded by the function's lifetime, so something has to
 * keep asking for the next one. Here that something is the page the operator is
 * already staring at while he waits.
 */
export function ReAudit({ leadId, pending }: { leadId: string; pending: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function nudge(leadIds: string[] | null): Promise<number | null> {
    const response = await fetch('/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadIds ? { leadIds } : {}),
    })
    const body = (await response.json()) as { pending?: number; error?: string }
    if (!response.ok) throw new Error(body.error ?? 'The audit could not be started.')
    return typeof body.pending === 'number' ? body.pending : null
  }

  async function start() {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    try {
      await nudge([leadId])
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The audit could not be started.')
      setRunning(false)
    } finally {
      inFlight.current = false
    }
  }

  /*
   * While this lead is mid-audit, keep the pass moving and refresh when it
   * lands. The interval clears itself the moment the server stops reporting
   * work outstanding, so a finished audit costs nothing.
   */
  const lastPending = useRef<number | null>(null)

  /*
   * `running` covers the gap between the click and the server admitting there
   * is work outstanding. Once the server says the queue is empty again, it has
   * to be let go — adjusted during render rather than in an effect, which is
   * React's own answer for state that follows a prop and avoids the extra
   * render pass an effect would cost.
   */
  const [wasPending, setWasPending] = useState(pending)
  if (pending !== wasPending) {
    setWasPending(pending)
    if (!pending) setRunning(false)
  }

  useEffect(() => {
    if (!pending) {
      lastPending.current = null
      return
    }

    const timer = setInterval(async () => {
      try {
        const remaining = await nudge(null)
        // Refresh when the queue actually moves, not on every tick: a redraw
        // that changes nothing is a redraw the operator has to check.
        if (remaining !== null && remaining !== lastPending.current) {
          lastPending.current = remaining
          router.refresh()
        }
      } catch {
        // A failed poll is not worth telling him about; the next one will do.
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [pending, router])

  const busy = pending || running

  return (
    <span className="flex items-center gap-2">
      {error ? (
        <span className="label text-alert" role="status">
          {error}
        </span>
      ) : null}
      <CommandButton onClick={start} disabled={busy}>
        {busy ? 'Auditing' : 'Re-audit'}
      </CommandButton>
    </span>
  )
}
