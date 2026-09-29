'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { NoSummaryReason, StoredSummary } from '@/lib/assistant/types'
import { patchLead } from '@/lib/leads/patch'
import type { LeadStatus } from '@/lib/leads/types'

/*
 * The minute after the line drops.
 *
 * Two things happen in it and this hook holds both, because they are one motion
 * to the operator: the assistant writes up what was said, and he takes the parts
 * of it he agrees with. Separating them into two hooks would put the "taken"
 * state somewhere that cannot see whether there is anything to take.
 *
 * NOTHING IS WRITTEN WITHOUT A PRESS, and that is the rule the whole file is
 * arranged around rather than a caveat at the end of it. `generate` produces a
 * paragraph and three suggestions and writes them to `call_summaries`, which is
 * the assistant's own row; not one of them touches the lead. `takeNote`,
 * `takeStatus` and `takeFollowUp` are the only functions here that move
 * anything the operator's book is made of, and each is one button. A tool that
 * set a status on its own is a tool whose status history stops being evidence.
 *
 * EACH PART GOES SEPARATELY, on purpose. He will believe the paragraph and not
 * the status, or want the callback date and none of the prose, and a single
 * "accept" button would make him take the lot or retype the half he wanted. The
 * cost is one request per part instead of one for all three, which is a cost
 * paid entirely by a laptop that has just stopped listening.
 *
 * THE LEAD IS MOVED THROUGH `patchLead`, which is the same call the lead page
 * and the outreach queue make. There is deliberately no second way to write a
 * status in this product — see the note in `lib/leads/patch.ts`.
 */

export type SummaryStatus = 'idle' | 'writing' | 'ready' | 'none' | 'failed'

/** Which suggestions have been taken, so the surface can stop offering them. */
export interface TakenParts {
  note: boolean
  status: boolean
  followUp: boolean
}

export interface CallSummaryState {
  status: SummaryStatus
  summary: StoredSummary | null
  /** Why there is nothing to show, when `status` is `none`. */
  reason: NoSummaryReason | null
  error: string | null
  taken: TakenParts
  /** How the call has been filed, once he has said. */
  outcome: string | null
  /** A write is in flight. The buttons go quiet rather than firing twice. */
  busy: boolean
  /** True once he has answered the summary either way — taken something, or not. */
  answered: boolean
  generate: (options?: { regenerate?: boolean }) => void
  takeNote: () => void
  takeStatus: () => void
  takeFollowUp: () => void
  fileOutcome: (outcome: string) => void
  /** Looked, took nothing. A real answer, and a different fact from not looking. */
  dismiss: () => void
}

export function useCallSummary({
  callId,
  leadId,
  initialSummary,
  initialOutcome,
}: {
  callId: string
  leadId: string
  /** The summary this call already had on page load, when it has one. */
  initialSummary: StoredSummary | null
  /** `calls.outcome`, when it has already been filed. */
  initialOutcome: string | null
}): CallSummaryState {
  const [summary, setSummary] = useState<StoredSummary | null>(initialSummary)
  const [status, setStatus] = useState<SummaryStatus>(initialSummary ? 'ready' : 'idle')
  const [reason, setReason] = useState<NoSummaryReason | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [taken, setTaken] = useState<TakenParts>({ note: false, status: false, followUp: false })
  const [outcome, setOutcome] = useState<string | null>(initialOutcome)
  const [busy, setBusy] = useState(false)
  /*
   * Whether he has already answered this summary, which is exactly what a
   * non-null `accepted` means. Written the long way rather than as
   * `initialSummary?.accepted !== null`, which is true when there is no summary
   * at all — `undefined !== null` — and would open the panel claiming an answer
   * to a paragraph nobody has written.
   */
  const [answered, setAnswered] = useState(
    initialSummary ? initialSummary.accepted !== null : false,
  )

  const abortRef = useRef<AbortController | null>(null)
  const writingRef = useRef(false)

  /*
   * A generation in flight when the operator leaves is a generation nobody is
   * waiting for. Aborted rather than left to land, which is the behaviour the
   * mock's `pause` was written to make possible — see the note on
   * `AssistantContext`. The row it would have written is not worth the request.
   */
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const generate = useCallback(
    async (options?: { regenerate?: boolean }) => {
      // Guarded against the second press rather than against the second render.
      // The route is idempotent by default, but a doubled request would still
      // spend a generation once a model is behind it.
      if (writingRef.current) return
      writingRef.current = true

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setStatus('writing')
      setError(null)
      setReason(null)

      try {
        const response = await fetch(`/api/calls/${callId}/summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ regenerate: options?.regenerate === true }),
          signal: controller.signal,
        })

        const body = (await response.json()) as {
          summary?: StoredSummary | null
          reason?: NoSummaryReason | null
          error?: string
        }
        if (!response.ok) throw new Error(body.error ?? 'The summary could not be written.')

        if (!body.summary) {
          // The honest answer, carried through as one. There is nothing to show
          // and the surface will say which kind of nothing it is.
          setReason(body.reason ?? 'no_transcript')
          setStatus('none')
          return
        }

        setSummary(body.summary)
        setAnswered(body.summary.accepted !== null)
        setTaken({ note: false, status: false, followUp: false })
        setStatus('ready')
      } catch (cause) {
        // An abort is the operator leaving, not a failure to report to him.
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'The summary could not be written.')
        setStatus('failed')
      } finally {
        writingRef.current = false
      }
    },
    [callId],
  )

  /**
   * Tell the call what just happened to the lead.
   *
   * Second, always, and never first. The lead move is what the operator pressed
   * the button for; this is the bookkeeping that makes the move analysable
   * later, and it is allowed to fail without costing him the thing he wanted —
   * the same posture the tips route takes, and for the same reason. A missing
   * `status_after` is a gap in a report nobody runs for months.
   */
  const recordHandover = useCallback(
    async (handover: { accepted?: boolean; outcome?: string; statusAfter?: LeadStatus }) => {
      try {
        const response = await fetch(`/api/calls/${callId}/summary`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(handover),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'The call record could not be updated.')
        }
      } catch (cause) {
        console.error('[call] could not record the handover', cause)
      }
    },
    [callId],
  )

  /**
   * One part, taken.
   *
   * The lead first and the bookkeeping second, and a failure on the lead stops
   * both: a call marked as accepted whose status never moved would be a row
   * claiming a change that did not happen, which is worse than no row at all.
   */
  const take = useCallback(
    async (
      patch: Parameters<typeof patchLead>[1],
      part: keyof TakenParts,
      statusAfter?: LeadStatus,
    ) => {
      if (busy) return
      setBusy(true)
      setError(null)

      try {
        await patchLead(leadId, patch)
        setTaken((current) => ({ ...current, [part]: true }))
        setAnswered(true)
        await recordHandover({ accepted: true, statusAfter })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That could not be saved.')
      } finally {
        setBusy(false)
      }
    },
    [busy, leadId, recordHandover],
  )

  const takeNote = useCallback(() => {
    if (!summary) return
    /*
     * The prose and the next step go in as one note, because that is how he
     * would have written it by hand — "here is what was said, here is what I am
     * doing about it". Two notes would be two lines in the timeline for one
     * conversation.
     */
    const body = summary.suggestedNextAction
      ? `${summary.body}\n\nNext: ${summary.suggestedNextAction}`
      : summary.body
    void take({ note: body }, 'note')
  }, [summary, take])

  const takeStatus = useCallback(() => {
    if (!summary?.suggestedStatus) return
    // `status_after` rides along on the same press. It is the only moment at
    // which the column is knowable: the operator has just decided.
    void take({ status: summary.suggestedStatus }, 'status', summary.suggestedStatus)
  }, [summary, take])

  const takeFollowUp = useCallback(() => {
    if (!summary?.suggestedFollowUpAt) return
    void take({ followUpAt: summary.suggestedFollowUpAt }, 'followUp')
  }, [summary, take])

  const fileOutcome = useCallback(
    (next: string) => {
      // Optimistic, and safe to be: `calls.outcome` is free text with no
      // validation to fail, and the chip he pressed staying lit is the only
      // feedback the press has.
      setOutcome(next)
      void recordHandover({ outcome: next })
    },
    [recordHandover],
  )

  const dismiss = useCallback(() => {
    setAnswered(true)
    void recordHandover({ accepted: false })
  }, [recordHandover])

  return {
    status,
    summary,
    reason,
    error,
    taken,
    outcome,
    busy,
    answered,
    generate: (options) => void generate(options),
    takeNote,
    takeStatus,
    takeFollowUp,
    fileOutcome,
    dismiss,
  }
}
