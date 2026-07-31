'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { IconAlert, IconClose } from '@/components/icons'
import { CommandButton } from '@/components/ui/command-button'
import { INPUT, Menu, MenuItem, MenuLabel } from '@/components/ui/controls'
import { FOLLOW_UP_PRESETS, datePlus, dueLabel, shortDate } from '@/lib/leads/dates'
import { patchLead, type LeadPatch } from '@/lib/leads/patch'
import { LEAD_STATUSES, LIMITS, type LeadRow, type LeadStatus } from '@/lib/leads/types'

/*
 * Working the lead: where it stands, when to come back, and what happened.
 *
 * Everything here is staged and committed once. That is not a preference about
 * forms — it is the shape of the actual decision. "Contacted, try again Tuesday,
 * left a voicemail with the owner's daughter" is one thing the operator
 * concluded on one call, and the route already writes it as one request with the
 * status trigger logging the transition itself. Firing three requests as he
 * clicks would put three lines in the history for one phone call, and that
 * history is the thing this product promises will still make sense in October.
 *
 * So a click here changes nothing yet; the band says what is staged, and `s` or
 * the Save control writes it. Discard puts it back.
 *
 * The band carries the amber left rule the selection bar carries, for the same
 * reason: this is the book, and this is the operator's own work being recorded
 * rather than anything Google said.
 */

export function LeadActions({ lead }: { lead: LeadRow }) {
  const router = useRouter()

  /** Null means "unchanged", never a status. Same for the date's `undefined`. */
  const [status, setStatus] = useState<LeadStatus | null>(null)
  const [followUpAt, setFollowUpAt] = useState<string | null | undefined>(undefined)
  const [note, setNote] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = status !== null || followUpAt !== undefined || note.trim() !== ''
  /** What the date field shows: the staged value, or what is already on the lead. */
  const shownDate = followUpAt === undefined ? lead.followUpAt : followUpAt

  function discard() {
    setStatus(null)
    setFollowUpAt(undefined)
    setNote('')
    setError(null)
  }

  async function save() {
    if (!dirty || busy) return

    const patch: LeadPatch = {}
    if (status !== null) patch.status = status
    if (followUpAt !== undefined) patch.followUpAt = followUpAt
    if (note.trim()) patch.note = note.trim()

    setBusy(true)
    setError(null)
    try {
      await patchLead(lead.id, patch)
      discard()
      // The header, the timeline and the follow-up column all read from the
      // server component above; refreshing is what makes the change appear
      // everywhere it is stated rather than only where it was typed.
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  /*
   * `s` saves, the way it does on the book and in the queue — and stands down
   * while he is typing the note, where an `s` is a letter.
   *
   * The listener is bound once and reads the current `save` through a ref:
   * re-subscribing on every keystroke in the note field would be a document
   * listener torn down and rebuilt per character.
   */
  const latest = useRef(save)
  useEffect(() => {
    latest.current = save
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.('input, textarea, select, [contenteditable]')) return
      if (event.key !== 's') return
      event.preventDefault()
      void latest.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const staged = [
    status,
    followUpAt === undefined
      ? null
      : followUpAt === null
        ? 'no follow-up'
        : `follow up ${shortDate(followUpAt)}`,
    note.trim() ? 'a note' : null,
  ].filter(Boolean)

  return (
    <div className="border-b border-rule border-l border-l-signal bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <span className="label shrink-0 text-ink-faint">Status</span>
        <Menu
          label={
            <span className={status ? 'text-signal' : 'text-ink'}>{status ?? lead.status}</span>
          }
          width="w-48"
          disabled={busy}
        >
          {(close) => (
            <>
              <MenuLabel>Set status to</MenuLabel>
              {LEAD_STATUSES.map((entry) => (
                <MenuItem
                  key={entry}
                  onClick={() => {
                    // Choosing the status it already has is a way of undoing a
                    // mis-click, not a change to write.
                    setStatus(entry === lead.status ? null : entry)
                    close()
                  }}
                >
                  <span className={entry === (status ?? lead.status) ? 'text-ink' : ''}>
                    {entry}
                  </span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>

        <span aria-hidden="true" className="hidden h-4 w-px bg-rule-strong md:block" />

        <span className="label shrink-0 text-ink-faint">Follow up</span>
        {FOLLOW_UP_PRESETS.map((preset) => (
          <CommandButton
            key={preset.key}
            type="button"
            disabled={busy}
            onClick={() => setFollowUpAt(datePlus(preset.step))}
          >
            {preset.label}
          </CommandButton>
        ))}

        {/* INPUT is w-full, so the box around a field owns its width — the same
            arrangement the filter bar's search uses. */}
        <span className="w-40 shrink-0">
          <input
            type="date"
            value={shownDate ?? ''}
            disabled={busy}
            aria-label="Follow-up date"
            onChange={(event) => setFollowUpAt(event.target.value || null)}
            className={INPUT}
          />
        </span>

        {shownDate ? (
          <>
            <span
              className={`font-data text-micro ${followUpAt !== undefined ? 'text-signal' : 'text-ink-faint'}`}
            >
              {dueLabel(shownDate)}
            </span>
            <CommandButton
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => setFollowUpAt(null)}
            >
              <IconClose className="size-3" />
              Clear
            </CommandButton>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 pb-2">
        <span className="min-w-[16rem] flex-1">
          <textarea
            rows={2}
            value={note}
            disabled={busy}
            // The route refuses past this. A field that accepts four thousand
            // characters and loses them on save is worse than one that stops.
            maxLength={LIMITS.note}
            placeholder="What happened. Saved with the status above, as one entry."
            aria-label="Note"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // The one save gesture available from inside the field, since `s`
              // is a letter here.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void save()
              }
              if (event.key === 'Escape') event.currentTarget.blur()
            }}
            className={`${INPUT} resize-y font-ui`}
          />
        </span>

        <div className="flex shrink-0 items-center gap-2">
          <CommandButton
            type="button"
            variant="primary"
            keyHint="S"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving' : 'Save'}
          </CommandButton>
          {dirty ? (
            <CommandButton type="button" variant="quiet" disabled={busy} onClick={discard}>
              Discard
            </CommandButton>
          ) : null}
        </div>
      </div>

      {/*
        Said before it is written, not after. The point of staging is that he can
        see the whole entry he is about to put in the history.
      */}
      {staged.length ? (
        <p className="px-3 pb-2 font-data text-micro text-signal">
          Will record: {staged.join(' · ')}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-2 border-t border-rule px-3 py-2">
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <span className="min-w-0 text-sm wrap-anywhere text-ink-dim">{error}</span>
        </p>
      ) : null}
    </div>
  )
}
