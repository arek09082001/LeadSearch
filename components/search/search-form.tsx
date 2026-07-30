'use client'

import { useEffect, useRef, useState } from 'react'

import { IconRefresh, IconSearch } from '@/components/icons'
import { CategorySelect } from '@/components/search/category-select'
import { CommandButton } from '@/components/ui/command-button'
import type { SearchInput } from '@/lib/search/types'

/*
 * The query bar. One ruled row on a wide screen, stacked below `lg`.
 *
 * Labels sit above their fields in `label` caps rather than inside as
 * placeholders: a placeholder disappears the moment you type, and this is a
 * form the operator re-reads and edits between searches rather than fills once.
 *
 * Radius is disabled until a location is typed, because a radius with no centre
 * is not a search — and the disabled state says so rather than silently
 * ignoring the number.
 */

/** Metres. Round numbers a person actually thinks in, not a slider. */
const RADIUS_OPTIONS = [
  { value: 0, label: 'No limit' },
  { value: 1_000, label: '1 km' },
  { value: 2_500, label: '2.5 km' },
  { value: 5_000, label: '5 km' },
  { value: 10_000, label: '10 km' },
  { value: 25_000, label: '25 km' },
  { value: 50_000, label: '50 km' },
]

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label flex items-baseline gap-1.5 text-ink-faint">
        {label}
        {hint ? <span className="font-data text-micro normal-case">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

const INPUT =
  'w-full border border-rule bg-ground px-2.5 py-2 font-data text-sm text-ink outline-none ' +
  'transition-colors hover:border-rule-strong focus:border-signal ' +
  'placeholder:text-ink-faint disabled:border-rule disabled:text-ink-ghost'

export function SearchForm({
  onSubmit,
  onCancel,
  running,
}: {
  onSubmit: (input: SearchInput) => void
  onCancel: () => void
  running: boolean
}) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [radiusM, setRadiusM] = useState(0)
  const [category, setCategory] = useState('')
  const queryRef = useRef<HTMLInputElement>(null)

  // `/` focuses the query, the way every terminal-shaped tool does. Alt+1/2/3
  // are already taken by the nav, so a bare key is free here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable]')) return
      event.preventDefault()
      queryRef.current?.focus()
      queryRef.current?.select()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const canSubmit = Boolean(query.trim() || category)

  function submit(refresh: boolean) {
    if (!canSubmit || running) return
    onSubmit({
      query: query.trim(),
      location: location.trim() || undefined,
      // A radius without a location has nothing to centre on, so it is dropped
      // rather than sent and silently ignored.
      radiusM: location.trim() && radiusM ? radiusM : undefined,
      category: category || undefined,
      refresh,
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit(false)
      }}
      className="border-b border-rule px-2 py-2.5 md:px-3"
    >
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_9rem_minmax(0,1.4fr)_auto] lg:items-end">
        <Field label="Query" hint="/">
          <input
            ref={queryRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Zahnarzt"
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </Field>

        <Field label="Location">
          <input
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Heilbronn"
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </Field>

        <Field label="Radius">
          <select
            value={radiusM}
            onChange={(event) => setRadiusM(Number(event.target.value))}
            disabled={!location.trim()}
            title={location.trim() ? undefined : 'Enter a location to search within a radius'}
            className={INPUT}
          >
            {RADIUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <CategorySelect value={category} onChange={setCategory} />
        </Field>

        <div className="flex items-center gap-2">
          {running ? (
            <CommandButton type="button" onClick={onCancel} className="h-[34px]">
              Stop
            </CommandButton>
          ) : (
            <>
              <CommandButton
                type="submit"
                variant="primary"
                disabled={!canSubmit}
                className="h-[34px]"
              >
                <IconSearch className="size-3.5" />
                Search
              </CommandButton>
              {/*
                A separate control, not a checkbox: re-fetching is the one action
                here that always costs money, so it has to be chosen, never left
                switched on from last time.
              */}
              <CommandButton
                type="button"
                onClick={() => submit(true)}
                disabled={!canSubmit}
                title="Ignore the cached result set and pay for fresh data"
                aria-label="Search again with fresh data"
                className="h-[34px]"
              >
                <IconRefresh className="size-3.5" />
                Fresh
              </CommandButton>
            </>
          )}
        </div>
      </div>
    </form>
  )
}
