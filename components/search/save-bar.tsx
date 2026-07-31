'use client'

import { useEffect, useState } from 'react'

import { IconAlert, IconBook, IconCheck, IconClose, IconPlus } from '@/components/icons'
import { CommandButton, CommandLink } from '@/components/ui/command-button'
import { INPUT, Menu, MenuItem, MenuLabel } from '@/components/ui/controls'
import { LIMITS, type SaveResult, type SaveResultItem } from '@/lib/leads/types'
import type { SearchRow } from '@/lib/search/types'

/*
 * The band where a selection becomes a decision.
 *
 * It only exists while something is ticked. A permanent bar with a disabled
 * button would be a piece of chrome the operator scrolls past sixty times a
 * session; appearing on selection makes the surface say "you have chosen
 * something, here is what you can do with it" at exactly the moment that is
 * true.
 *
 * It is `signal` amber throughout, because amber is the book in this product,
 * and this is the one control in the whole search surface that writes to it.
 */

interface ListOption {
  id: string
  name: string
}

/** The selection shortcuts. This is what "select filtered" means on this surface. */
function selections(rows: SearchRow[]) {
  return [
    { key: 'all', label: 'All results', match: () => true },
    {
      key: 'no_site',
      label: 'Without a website',
      // The whole reason this surface exists, as a one-click selection.
      match: (row: SearchRow) => !row.website,
    },
    {
      key: 'unsaved',
      label: 'Not already in the book',
      match: (row: SearchRow) => !row.savedLeadId,
    },
    {
      key: 'no_site_unsaved',
      label: 'No website, not yet saved',
      match: (row: SearchRow) => !row.website && !row.savedLeadId,
    },
  ].map((entry) => ({
    ...entry,
    count: rows.filter(entry.match).length,
  }))
}

export function SaveBar({
  rows,
  selected,
  onSelect,
  searchId,
  onSaved,
}: {
  rows: SearchRow[]
  selected: Set<string>
  onSelect: (next: Set<string>) => void
  searchId: string | null
  /** Lets the table redraw its `In book` marks without another round trip. */
  onSaved: (items: SaveResultItem[]) => void
}) {
  const [lists, setLists] = useState<ListOption[]>([])
  const [listId, setListId] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<SaveResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Loaded once, lazily: the picker is only meaningful once something is
  // selected, and most sessions never open it.
  useEffect(() => {
    if (!selected.size || lists.length) return
    let cancelled = false
    fetch('/api/lists')
      .then((response) => response.json())
      .then((body: { lists?: ListOption[] }) => {
        if (!cancelled && body.lists) setLists(body.lists)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selected.size, lists.length])

  const chosen = rows.filter((row) => selected.has(row.providerPlaceId))
  const listLabel = listId
    ? (lists.find((list) => list.id === listId)?.name ?? 'List')
    : newListName.trim()
      ? `New: ${newListName.trim()}`
      : 'No list'

  async function save() {
    if (!chosen.length || saving) return
    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchId,
          listId,
          newListName: listId ? null : newListName.trim() || null,
          note: note.trim() || null,
          candidates: chosen.map((row) => ({
            googlePlaceId: row.providerPlaceId,
            name: row.name,
            formattedAddress: row.formattedAddress,
            lat: row.lat,
            lng: row.lng,
            phone: row.phone,
            website: row.website,
            rating: row.rating,
            userRatingCount: row.userRatingCount,
            businessStatus: row.businessStatus,
            primaryType: row.primaryType,
            types: row.types,
            mapsUri: row.mapsUri,
            raw: row.raw,
            // Carried through so the lead records the age of the data it was
            // saved from, not the moment the button was pressed.
            fetchedAt: row.fetchedAt,
          })),
        }),
      })

      const body = await response.json()
      if (!response.ok) throw new Error(body?.error ?? `The save failed (HTTP ${response.status}).`)

      const result = body as SaveResult
      setReceipt(result)
      onSaved(result.items)

      // Only a clean save clears the selection. If something failed, the rows
      // stay ticked so the retry is one click rather than a re-selection.
      if (!result.failed) {
        onSelect(new Set())
        setNote('')
        setNewListName('')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The save could not be sent.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {receipt ? <Receipt result={receipt} onDismiss={() => setReceipt(null)} /> : null}

      {error ? (
        <div className="flex items-start gap-2 border-b border-rule border-l border-l-alert bg-panel px-3 py-2">
          <IconAlert className="mt-0.5 size-3.5 shrink-0 text-alert" />
          <div className="min-w-0">
            <p className="label text-alert">Nothing was saved</p>
            <p className="mt-0.5 text-sm text-ink-dim">{error}</p>
          </div>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-rule border-l border-l-signal bg-panel px-2 py-2 md:px-3">
          <span className="label shrink-0 text-signal">
            {selected.size} selected
          </span>

          <Menu label="Select" width="w-60">
            {(close) => (
              <>
                <MenuLabel>Replace the selection with</MenuLabel>
                {selections(rows).map((entry) => (
                  <MenuItem
                    key={entry.key}
                    disabled={entry.count === 0}
                    onClick={() => {
                      onSelect(
                        new Set(
                          rows.filter(entry.match).map((row) => row.providerPlaceId),
                        ),
                      )
                      close()
                    }}
                  >
                    <span className="flex-1">{entry.label}</span>
                    <span className="font-data text-micro text-ink-faint">{entry.count}</span>
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>

          <CommandButton type="button" variant="quiet" onClick={() => onSelect(new Set())}>
            <IconClose className="size-3" />
            Clear
          </CommandButton>

          <span aria-hidden="true" className="hidden h-4 w-px bg-rule-strong md:block" />

          <Menu label={listLabel} width="w-64">
            {(close) => (
              <>
                <MenuLabel>File under</MenuLabel>
                <MenuItem
                  onClick={() => {
                    setListId(null)
                    setNewListName('')
                    close()
                  }}
                >
                  No list
                </MenuItem>
                {lists.map((list) => (
                  <MenuItem
                    key={list.id}
                    onClick={() => {
                      setListId(list.id)
                      setNewListName('')
                      close()
                    }}
                  >
                    <span className="flex-1 truncate">{list.name}</span>
                    {listId === list.id ? <IconCheck className="size-3 text-signal" /> : null}
                  </MenuItem>
                ))}
                <div className="border-t border-rule p-2">
                  <label className="label mb-1 block text-ink-faint">Or a new list</label>
                  <input
                    type="text"
                    value={newListName}
                    maxLength={LIMITS.name}
                    onChange={(event) => {
                      setNewListName(event.target.value)
                      // Typing a new name is a choice against the picked list.
                      if (event.target.value) setListId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        close()
                      }
                    }}
                    placeholder="Heilbronn Q3"
                    className={INPUT}
                  />
                </div>
              </>
            )}
          </Menu>

          <input
            type="text"
            value={note}
            maxLength={LIMITS.note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note on all of them (optional)"
            aria-label="Note applied to every lead in this selection"
            className={`${INPUT} min-w-[10rem] flex-1 md:max-w-md`}
          />

          <CommandButton
            type="button"
            variant="primary"
            onClick={save}
            disabled={saving}
            className="shrink-0"
          >
            <IconPlus className="size-3.5" />
            {saving ? 'Saving…' : `Save ${selected.size} to leads`}
          </CommandButton>
        </div>
      ) : null}
    </>
  )
}

/**
 * The receipt.
 *
 * Four outcomes reported separately rather than one number, because they mean
 * different things: `saved` is new work, `updated` means the selection was
 * wider than he thought, `restored` means he has just undone a delete, and
 * `failed` needs him. Names are listed for everything except the plain saves —
 * those he already knows, he just picked them.
 */
function Receipt({ result, onDismiss }: { result: SaveResult; onDismiss: () => void }) {
  const failed = result.items.filter((item) => item.outcome === 'failed')
  const updated = result.items.filter((item) => item.outcome === 'updated')
  const restored = result.items.filter((item) => item.outcome === 'restored')

  const tone = result.failed ? 'border-l-alert' : 'border-l-signal'

  return (
    <div className={`border-b border-rule border-l ${tone} bg-panel px-3 py-2`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="label flex items-center gap-1.5 text-signal">
          <IconBook className="size-3.5" />
          Saved to the book
        </span>

        <span className="text-sm text-ink">
          {result.saved > 0 ? (
            <strong className="font-semibold text-ink">{result.saved} new</strong>
          ) : (
            <span className="text-ink-faint">no new leads</span>
          )}
          {result.updated > 0 ? (
            <span className="text-ink-dim"> · {result.updated} already there, refreshed</span>
          ) : null}
          {result.restored > 0 ? (
            <span className="text-ink-dim"> · {result.restored} restored from deleted</span>
          ) : null}
          {result.failed > 0 ? (
            <span className="text-alert"> · {result.failed} failed</span>
          ) : null}
        </span>

        {result.list ? (
          <span className="label text-ink-faint">Filed under {result.list.name}</span>
        ) : null}

        {result.enrichmentQueued > 0 ? (
          <span className="label text-ink-faint">
            Auditing {result.enrichmentQueued} in the background
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <CommandLink href="/leads" variant="primary">
            Open leads
          </CommandLink>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="p-1 text-ink-faint transition-colors hover:text-ink"
          >
            <IconClose className="size-3.5" />
          </button>
        </div>
      </div>

      {failed.length || updated.length || restored.length ? (
        <div className="mt-1.5 flex flex-col gap-1">
          <NameList label="Failed" items={failed} tone="text-alert" showReason />
          <NameList label="Already there" items={updated} tone="text-ink-faint" />
          <NameList label="Restored" items={restored} tone="text-ink-faint" />
        </div>
      ) : null}
    </div>
  )
}

function NameList({
  label,
  items,
  tone,
  showReason,
}: {
  label: string
  items: SaveResultItem[]
  tone: string
  showReason?: boolean
}) {
  if (!items.length) return null
  return (
    <p className={`text-sm ${tone}`}>
      <span className="label mr-1.5">{label}</span>
      {items.map((item, index) => (
        <span key={item.googlePlaceId}>
          {index > 0 ? ', ' : ''}
          {item.name}
          {showReason && item.error ? (
            <span className="font-data text-micro text-ink-faint"> ({item.error})</span>
          ) : null}
        </span>
      ))}
    </p>
  )
}
