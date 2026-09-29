'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { IconChevronDown, IconClose } from '@/components/icons'
import { PLACE_TYPE_GROUPS, formatPlaceType } from '@/lib/places-types'

/*
 * The category picker: a filter over every Google Places type.
 *
 * A combobox rather than a <select> because the list runs to several hundred
 * entries and native type-ahead only matches a prefix — the operator looking
 * for `dental_clinic` will type "dent", and a prefix match sends him to
 * `deli`. The token stays visible beside the label because the token is what
 * Google matches on and what he will recognise in a saved search.
 *
 * Standard combobox semantics, not invented ones: the input owns the role, the
 * list owns the options, and the active option is pointed at with
 * aria-activedescendant so focus never leaves the field.
 */

interface Option {
  token: string
  label: string
  group: string
}

const OPTIONS: Option[] = PLACE_TYPE_GROUPS.flatMap((group) =>
  group.types.map((token) => ({ token, label: formatPlaceType(token), group: group.label })),
)

export function CategorySelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (token: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)

  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return OPTIONS
    // Match the token and the label: "dental" finds dental_clinic, "salon"
    // finds both hair_salon and beauty_salon.
    return OPTIONS.filter(
      (option) =>
        option.token.includes(needle) || option.label.toLowerCase().includes(needle),
    )
  }, [filter])

  // The active option resets alongside the filter, in the handler that changed
  // it — not in an effect reacting to it afterwards, which would render the old
  // highlight against the new list for a frame before correcting itself.
  function filterTo(next: string) {
    setFilter(next)
    setActive(0)
  }

  // Close on a click elsewhere, the way every other menu on the machine does.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the active option in view while arrowing through several hundred rows.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open])

  function choose(option: Option | undefined) {
    if (!option) return
    onChange(option.token)
    filterTo('')
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((prev) => Math.min(matches.length - 1, Math.max(0, prev + step)))
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActive(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActive(matches.length - 1)
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      choose(matches[active])
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.stopPropagation()
        setOpen(false)
        filterTo('')
      }
    }
  }

  const selected = value ? OPTIONS.find((option) => option.token === value) : undefined

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center border border-rule bg-ground focus-within:border-signal hover:border-rule-strong">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches.length ? optionId(active) : undefined}
          disabled={disabled}
          // Two jobs, one field: it shows the selection at rest and filters once
          // typing starts, so there is no separate "change it" affordance.
          value={open ? filter : (selected?.label ?? '')}
          placeholder={selected ? selected.label : 'Any category'}
          onChange={(event) => {
            filterTo(event.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent px-2.5 py-2 font-data text-sm text-ink outline-none placeholder:text-ink-faint disabled:text-ink-faint"
        />

        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              filterTo('')
            }}
            disabled={disabled}
            aria-label="Clear category"
            className="px-2 py-2 text-ink-faint transition-colors hover:text-alert"
          >
            <IconClose className="size-3.5" />
          </button>
        ) : null}

        <IconChevronDown className="pointer-events-none mr-2 size-3.5 shrink-0 text-ink-faint" />
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Place category"
          className="absolute top-full right-0 left-0 z-20 max-h-72 overflow-y-auto border border-rule-strong border-t-rule bg-panel"
        >
          {matches.length === 0 ? (
            <li className="px-2.5 py-2 text-sm text-ink-faint">
              No Places type matches “{filter.trim()}”.
            </li>
          ) : (
            matches.map((option, index) => {
              // Repeat the group heading whenever it changes, so a filtered list
              // still says which part of Google's taxonomy each row came from.
              const newGroup = index === 0 || matches[index - 1].group !== option.group
              return (
                <li key={option.token}>
                  {newGroup ? (
                    <div
                      role="presentation"
                      className="label border-b border-rule bg-ground px-2.5 py-1 text-ink-faint"
                    >
                      {option.group}
                    </div>
                  ) : null}
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={option.token === value}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      choose(option)
                    }}
                    onPointerEnter={() => setActive(index)}
                    className={`flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1 ${
                      index === active ? 'bg-raise text-ink' : 'text-ink-dim'
                    }`}
                  >
                    <span className="truncate text-sm">{option.label}</span>
                    <span className="shrink-0 font-data text-micro text-ink-faint">
                      {option.token}
                    </span>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
