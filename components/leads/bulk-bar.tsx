'use client'

import { useState } from 'react'

import { IconClose, IconRefresh, IconStrike, IconUndo } from '@/components/icons'
import { CommandButton } from '@/components/ui/command-button'
import { INPUT, Menu, MenuItem, MenuLabel } from '@/components/ui/controls'
import { LEAD_STATUSES, type BulkAction, type LeadStatus } from '@/lib/leads/types'

/*
 * What a selection can be turned into.
 *
 * Appears on selection, like the save bar on the feed, and for the same reason.
 * Delete sits at the far right, apart from the rest and the only control in the
 * product that goes `alert` — it is the one action here the operator would
 * regret, and it should never be adjacent to the one he does sixty times.
 *
 * It is still soft. The undo band that follows is not an apology for a
 * dangerous control; it is the second half of the same promise.
 */

export function BulkBar({
  count,
  /** True when the selection is "everything matching the filters", not just this page. */
  wholeFilter,
  totalMatching,
  lists,
  deletedView,
  onClear,
  onSelectFiltered,
  onAction,
  busy,
}: {
  count: number
  wholeFilter: boolean
  totalMatching: number
  lists: { id: string; name: string }[]
  deletedView: boolean
  onClear: () => void
  onSelectFiltered: () => void
  onAction: (action: BulkAction) => void
  busy: boolean
}) {
  const [newListName, setNewListName] = useState('')
  const [followUp, setFollowUp] = useState('')

  if (!count) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-rule border-l border-l-signal bg-panel px-2 py-2 md:px-3">
      <span className="label shrink-0 text-signal">{count} selected</span>

      {/*
        Only offered when it would actually widen the selection. On a library
        that fits one page, "select all 74 matching" next to "74 selected" is a
        control that does nothing.
      */}
      {!wholeFilter && totalMatching > count ? (
        <CommandButton type="button" variant="quiet" onClick={onSelectFiltered}>
          Select all {totalMatching.toLocaleString('de-DE')} matching
        </CommandButton>
      ) : null}

      <CommandButton type="button" variant="quiet" onClick={onClear}>
        <IconClose className="size-3" />
        Clear
      </CommandButton>

      <span aria-hidden="true" className="hidden h-4 w-px bg-rule-strong md:block" />

      {deletedView ? (
        <CommandButton
          type="button"
          variant="primary"
          disabled={busy}
          onClick={() => onAction({ action: 'restore' })}
        >
          <IconUndo className="size-3.5" />
          Restore
        </CommandButton>
      ) : (
        <>
          <Menu label="Status" width="w-48" disabled={busy}>
            {(close) => (
              <>
                <MenuLabel>Set status to</MenuLabel>
                {LEAD_STATUSES.map((status) => (
                  <MenuItem
                    key={status}
                    onClick={() => {
                      onAction({ action: 'status', status: status as LeadStatus })
                      close()
                    }}
                  >
                    {status}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>

          <Menu label="Add to list" width="w-64" disabled={busy}>
            {(close) => (
              <>
                <MenuLabel>Add to</MenuLabel>
                {lists.map((list) => (
                  <MenuItem
                    key={list.id}
                    onClick={() => {
                      onAction({ action: 'add_to_list', listId: list.id })
                      close()
                    }}
                  >
                    <span className="truncate">{list.name}</span>
                  </MenuItem>
                ))}
                {lists.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-sm text-ink-faint">No lists yet.</p>
                ) : null}
                <div className="border-t border-rule p-2">
                  <label className="label mb-1 block text-ink-faint">Or a new list</label>
                  <input
                    type="text"
                    value={newListName}
                    onChange={(event) => setNewListName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || !newListName.trim()) return
                      event.preventDefault()
                      onAction({ action: 'add_to_list', newListName: newListName.trim() })
                      setNewListName('')
                      close()
                    }}
                    placeholder="Heilbronn Q3"
                    className={INPUT}
                  />
                </div>
              </>
            )}
          </Menu>

          <Menu label="Follow-up" width="w-60" disabled={busy}>
            {(close) => (
              <div className="p-2">
                <MenuLabel>Follow up on</MenuLabel>
                <input
                  type="date"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  aria-label="Follow-up date"
                  className={`${INPUT} mt-2`}
                />
                <div className="mt-2 flex items-center gap-2">
                  <CommandButton
                    type="button"
                    variant="primary"
                    disabled={!followUp}
                    onClick={() => {
                      onAction({ action: 'follow_up', followUpAt: followUp })
                      close()
                    }}
                  >
                    Set
                  </CommandButton>
                  <CommandButton
                    type="button"
                    onClick={() => {
                      onAction({ action: 'follow_up', followUpAt: null })
                      close()
                    }}
                  >
                    Clear date
                  </CommandButton>
                </div>
              </div>
            )}
          </Menu>

          <CommandButton
            type="button"
            disabled={busy}
            onClick={() => onAction({ action: 're_audit' })}
            title="Fetch each website again and re-record what is there"
          >
            <IconRefresh className="size-3.5" />
            Re-audit
          </CommandButton>

          <CommandButton
            type="button"
            disabled={busy}
            onClick={() => onAction({ action: 'delete' })}
            className="ml-auto border-rule-strong text-ink-faint hover:border-alert hover:bg-transparent hover:text-alert"
          >
            <IconStrike className="size-3.5" />
            Delete
          </CommandButton>
        </>
      )}
    </div>
  )
}
