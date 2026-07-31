'use client'

import { useRef, useState } from 'react'

import { IconAlert, IconClose } from '@/components/icons'
import {
  FollowUpMenu,
  StatusMenu,
  useLeadPatch,
  type LeadPatch,
} from '@/components/leads/lead-controls'
import { useHotkey } from '@/components/shell/keys'
import { CommandButton } from '@/components/ui/command-button'
import { INPUT } from '@/components/ui/controls'
import { relativeDay, shortDate } from '@/lib/leads/dates'
import type { LeadRow } from '@/lib/leads/types'

/*
 * Where the operator records what he did.
 *
 * The band sits directly under the business's name and above the diagnosis,
 * which is the order of the call: this is who they are, this is where we are
 * with them, and this is what is wrong with their website. Putting it in the
 * aside would have made the one part of the page he writes to the one part he
 * has to go looking for.
 *
 * The note field is the reason this is a single component rather than two
 * controls side by side. PATCH takes a status, a date and a note in one body,
 * so a note typed here rides along with whatever he does next — pick
 * `contacted` with "no answer, receptionist said Tuesday" in the box and both
 * land in one request, in one order, with one failure mode. Writing the note by
 * itself is the same control with nothing else attached.
 */

export function LeadActions({ lead }: { lead: LeadRow }) {
  const { patch, pending, error, dismissError } = useLeadPatch()
  const [note, setNote] = useState('')
  const [receipt, setReceipt] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  const busy = pending !== null

  /** Whatever is in the box, sent with the action rather than after it. */
  function carried(): string | undefined {
    const trimmed = note.trim()
    return trimmed ? trimmed : undefined
  }

  async function send(body: LeadPatch, said: string) {
    const carriedNote = body.note
    if (await patch(lead.id, body)) {
      setNote('')
      setReceipt(carriedNote ? `${said} · note added` : said)
    }
  }

  function saveNote() {
    const body = carried()
    if (!body || busy) {
      // Nothing typed yet, so `s` means "put me where the note goes" instead of
      // failing silently — the key still does something on every press.
      field.current?.focus()
      return
    }
    void send({ note: body }, 'Note added')
  }

  // `s` saves, as it does on every surface. Bound here rather than in the page
  // so it follows the control it commits.
  useHotkey('s', saveNote)

  return (
    <div className="border-b border-rule bg-panel">
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 md:px-3">
        <span className="label shrink-0 text-ink-faint">Status</span>
        <StatusMenu
          status={lead.status}
          disabled={busy}
          onPick={(status) => void send({ status, note: carried() }, `Status set to ${status}`)}
        />

        <span aria-hidden="true" className="hidden h-4 w-px bg-rule-strong md:block" />

        <span className="label shrink-0 text-ink-faint">Follow up</span>
        <FollowUpMenu
          followUpAt={lead.followUpAt}
          disabled={busy}
          onPick={(followUpAt) =>
            void send(
              { followUpAt, note: carried() },
              followUpAt ? `Follow-up set for ${shortDate(followUpAt)}` : 'Follow-up cleared',
            )
          }
        />

        {/* The relative reading, because "14.08.26" is not a decision and
            "in 5d" is. Absent when there is no date to be relative to. */}
        {lead.followUpAt ? (
          <span className="font-data text-micro text-ink-faint">
            {relativeDay(lead.followUpAt)}
          </span>
        ) : null}

        <form
          className="flex min-w-[12rem] flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            saveNote()
          }}
        >
          <input
            ref={field}
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
            placeholder="Note — sent with the next status or date change"
            aria-label="Note on this lead"
            className={`${INPUT} min-w-0 flex-1`}
          />
          <CommandButton
            type="submit"
            variant="primary"
            disabled={busy || !note.trim()}
            keyHint="s"
            className="shrink-0"
          >
            {busy ? 'Saving' : 'Add note'}
          </CommandButton>
        </form>
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-t border-rule border-l border-l-alert px-3 py-2">
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <p className="flex-1 text-sm text-ink-dim">{error}</p>
          <button
            type="button"
            onClick={dismissError}
            aria-label="Dismiss"
            className="p-1 text-ink-faint transition-colors hover:text-ink"
          >
            <IconClose className="size-3.5" />
          </button>
        </div>
      ) : receipt ? (
        // Said once and left there. The history below is about to show the same
        // event with a timestamp on it, so this does not need to fade out.
        <p className="border-t border-rule px-3 py-1.5 text-sm text-ink-faint">{receipt}</p>
      ) : null}
    </div>
  )
}
