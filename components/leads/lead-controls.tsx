'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { IconCheck } from '@/components/icons'
import { STATUS_TONE } from '@/components/leads/tone'
import { Menu, MenuItem, MenuLabel } from '@/components/ui/controls'
import { FOLLOW_UP_PRESETS, presetDate, relativeDay, shortDate, today } from '@/lib/leads/dates'
import { LEAD_STATUSES, type LeadStatus } from '@/lib/leads/types'

/*
 * The two controls that write outreach, and the one request they write it with.
 *
 * They live in their own module because two surfaces need them and neither owns
 * them: a lead's own page, where the operator is reading the diagnosis before a
 * call, and the outreach queue, where he is working thirty rows without opening
 * any of them. A status menu that behaved differently in those two places would
 * be two vocabularies for one act.
 *
 * Everything goes through PATCH /api/leads/[id], which already accepts a status,
 * a date and a note in one body. That is deliberately not three endpoints: the
 * operator's real action is "contacted them, ring back Tuesday, here's what they
 * said", and splitting it into three requests would let two of them land and one
 * fail, leaving a lead whose status disagrees with its own history.
 */

export interface LeadPatch {
  status?: LeadStatus
  /** `null` clears the date. Omitted leaves it alone — the two are not the same. */
  followUpAt?: string | null
  note?: string
}

/**
 * Send one change and let the server redraw.
 *
 * `router.refresh()` rather than local state: the status trigger writes an
 * activity row the client never sees, the score cache may move, and the queues
 * this row belongs to are computed on the server. Patching a copy in the
 * browser would be a second, worse model of all of that.
 */
export function useLeadPatch() {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const patch = useCallback(
    async (leadId: string, body: LeadPatch): Promise<boolean> => {
      setPending(leadId)
      setError(null)
      try {
        const response = await fetch(`/api/leads/${leadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(payload?.error ?? 'The change was not saved.')
        router.refresh()
        return true
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The change was not saved.')
        return false
      } finally {
        setPending(null)
      }
    },
    [router],
  )

  return { patch, pending, error, dismissError: () => setError(null) }
}

/* ------------------------------------------------------------------------- *
 * Status
 * ------------------------------------------------------------------------- */

export function StatusMenu({
  status,
  disabled,
  onPick,
  variant = 'default',
}: {
  status: LeadStatus
  disabled?: boolean
  onPick: (status: LeadStatus) => void
  variant?: 'default' | 'quiet'
}) {
  return (
    <Menu
      label={<span className={STATUS_TONE[status]}>{status}</span>}
      width="w-44"
      disabled={disabled}
      variant={variant}
    >
      {(close) => (
        <>
          <MenuLabel>Set status</MenuLabel>
          {LEAD_STATUSES.map((entry) => (
            <MenuItem
              key={entry}
              onClick={() => {
                close()
                if (entry !== status) onPick(entry)
              }}
            >
              <span className="flex-1">{entry}</span>
              {entry === status ? <IconCheck className="size-3 shrink-0 text-signal" /> : null}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

/* ------------------------------------------------------------------------- *
 * Follow-up
 * ------------------------------------------------------------------------- */

/**
 * Three distances and a clear, which is the whole vocabulary.
 *
 * No date picker. The operator schedules in "ring them back in a week", not in
 * calendar coordinates, and a grid of thirty numbered squares is four decisions
 * (month, week, day, confirm) standing in for one. The resolved date is printed
 * on each row so the shorthand never has to be trusted blind.
 */
export function FollowUpMenu({
  followUpAt,
  disabled,
  onPick,
  variant = 'default',
}: {
  followUpAt: string | null
  disabled?: boolean
  onPick: (followUpAt: string | null) => void
  variant?: 'default' | 'quiet'
}) {
  const due = followUpAt !== null && followUpAt <= today()

  return (
    <Menu
      label={
        followUpAt ? (
          // Due or overdue is the operator's own decision coming back at him,
          // so it is `signal` — never `alert`, which would read as a fault.
          <span className={due ? 'text-signal' : 'text-ink-dim'}>{shortDate(followUpAt)}</span>
        ) : (
          <span className="text-ink-faint">No date</span>
        )
      }
      width="w-56"
      disabled={disabled}
      variant={variant}
    >
      {(close) => (
        <>
          <MenuLabel>Follow up</MenuLabel>
          {FOLLOW_UP_PRESETS.map((preset) => {
            const date = presetDate(preset)
            return (
              <MenuItem
                key={preset.key}
                onClick={() => {
                  close()
                  onPick(date)
                }}
              >
                <span className="flex-1">In {preset.label}</span>
                <span className="shrink-0 font-data text-micro text-ink-faint">
                  {shortDate(date)}
                </span>
              </MenuItem>
            )
          })}
          {followUpAt ? (
            <div className="border-t border-rule">
              <MenuItem
                onClick={() => {
                  close()
                  onPick(null)
                }}
              >
                <span className="flex-1">Clear the date</span>
                <span className="shrink-0 font-data text-micro text-ink-faint">
                  {relativeDay(followUpAt)}
                </span>
              </MenuItem>
            </div>
          ) : null}
        </>
      )}
    </Menu>
  )
}
