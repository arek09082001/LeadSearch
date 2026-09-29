'use client'

import { useState } from 'react'

import { IconCheck, IconMark, IconMore } from '@/components/icons'
import { CommandButton } from '@/components/ui/command-button'
import { INPUT, Menu, MenuItem, MenuLabel } from '@/components/ui/controls'
import { activeFilterCount, sameFilters, toSearchParams } from '@/lib/leads/filters'
import { LIMITS, type LeadFilters, type SavedView } from '@/lib/leads/types'

/*
 * Saved views — the filter set with a name on it.
 *
 * Drawn as a row of rules rather than pills or tabs: the active one is marked
 * by a 1px `signal` underline, exactly like the nav, because it is the same
 * idea — this is the surface you are on. A view is not a container, so it is
 * not drawn as one.
 *
 * "Save this view" only appears when there is something worth saving. An always
 * present button that does nothing on an unfiltered library is noise in a bar
 * the operator reads sixty times a session.
 */

export function SavedViews({
  views,
  filters,
  onApply,
  onChanged,
  naming,
  onNaming,
}: {
  views: SavedView[]
  filters: LeadFilters
  onApply: (filters: LeadFilters) => void
  /** Re-reads the views from the server after any edit. */
  onChanged: () => void
  /*
   * Naming is controlled from the console because `s` opens it. The keyboard
   * lives at the console level — one listener for the whole surface rather than
   * one per band — so the state it drives has to live there too.
   */
  naming: boolean
  onNaming: (naming: boolean) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeView = views.find((view) => sameFilters(view.filters, filters)) ?? null
  const canSave = activeFilterCount(filters) > 0 && !activeView

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(url, init)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? 'That did not work.')
      onChanged()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    if (!name.trim()) return
    const ok = await send('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), filters: toSearchParams(filters).toString() }),
    })
    if (ok) {
      setName('')
      onNaming(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-rule bg-panel px-2 py-1.5 md:px-3">
      <span className="label mr-1 flex shrink-0 items-center gap-1.5 text-ink-faint">
        <IconMark className="size-3.5" />
        Views
      </span>

      {views.length === 0 && !naming ? (
        <span className="text-sm text-ink-faint">
          None yet — filter the book, then save the result as a view you can come back to.
        </span>
      ) : null}

      {views.map((view) => {
        const isActive = activeView?.id === view.id
        return (
          <div key={view.id} className="flex items-center">
            <button
              type="button"
              onClick={() => {
                onApply(view.filters)
                // Fire and forget: knowing which views have gone cold is worth
                // having, and is never worth making him wait for.
                void fetch(`/api/views/${view.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ used: true }),
                })
              }}
              // A view name is capped at 60 characters server-side, and 60
              // characters of uppercase `label` is most of this bar. Bounded
              // here so a long name shortens its own chip rather than pushing
              // every other view off the row.
              title={view.name}
              className={`label max-w-[12rem] truncate border-b px-2 py-1 transition-colors ${
                isActive
                  ? 'border-signal text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink-dim'
              }`}
            >
              {view.name}
            </button>

            <Menu
              label={<IconMore className="size-3.5" />}
              variant="quiet"
              align="left"
              width="w-52"
            >
              {(close) => (
                <>
                  <MenuLabel>
                    <span className="block truncate" title={view.name}>
                      {view.name}
                    </span>
                  </MenuLabel>
                  <MenuItem
                    disabled={busy}
                    onClick={async () => {
                      await send(`/api/views/${view.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          filters: toSearchParams(filters).toString(),
                        }),
                      })
                      close()
                    }}
                  >
                    Overwrite with current filters
                  </MenuItem>
                  <MenuItem
                    disabled={busy}
                    tone="alert"
                    onClick={async () => {
                      await send(`/api/views/${view.id}`, { method: 'DELETE' })
                      close()
                    }}
                  >
                    Delete view
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        )
      })}

      <div className="ml-auto flex items-center gap-2">
        {error ? <span className="text-sm text-alert">{error}</span> : null}

        {naming ? (
          <>
            <input
              type="text"
              value={name}
              autoFocus
              // The route refuses past this. Stopping the keystroke is kinder
              // than taking the name and throwing it back.
              maxLength={LIMITS.name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void create()
                }
                if (event.key === 'Escape') onNaming(false)
              }}
              placeholder="No website, Heilbronn"
              aria-label="Name for this view"
              className={`${INPUT} w-56`}
            />
            <CommandButton type="button" variant="primary" disabled={busy} onClick={create}>
              <IconCheck className="size-3.5" />
              Save
            </CommandButton>
            <CommandButton type="button" variant="quiet" onClick={() => onNaming(false)}>
              Cancel
            </CommandButton>
          </>
        ) : canSave ? (
          <CommandButton type="button" keyHint="S" onClick={() => onNaming(true)}>
            <IconMark className="size-3.5" />
            Save this view
          </CommandButton>
        ) : null}
      </div>
    </div>
  )
}
