'use client'

import { useEffect, useMemo, useState } from 'react'

import { IconClose, IconFilter, IconSearch } from '@/components/icons'
import { SEARCH_ATTRIBUTE } from '@/components/shell/keys'
import { CommandButton } from '@/components/ui/command-button'
import { INPUT, Menu, MenuCheck, MenuItem, MenuLabel } from '@/components/ui/controls'
import { activeFilterCount } from '@/lib/leads/filters'
import { formatPlaceType } from '@/lib/places-types'
import {
  AUDIT_FILTERS,
  FOLLOW_UP_FILTERS,
  type AuditFilter,
  type FollowUpFilter,
  type LeadFacets,
  type LeadFilters,
  type LeadStatus,
} from '@/lib/leads/types'

/*
 * The filter bar.
 *
 * Every control here is populated from what is actually in the book — the city
 * list holds the eleven cities he has saved from, not every city in Germany.
 * Offering filters that can only ever return nothing is how a filter bar
 * teaches its user to ignore it.
 *
 * Each control writes to the URL, which is the only filter state there is. A
 * click here is a navigation, so the back button undoes it and the address bar
 * is always a shareable description of what is on screen.
 */

/** Toggle a value in one of the multi-select filters. */
function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
}

/** A multi-select menu with a search box, for the facets that run long. */
function FacetMenu({
  label,
  options,
  selected,
  onToggle,
  format = (value: string) => value,
}: {
  label: string
  /** `count` is omitted where a facet has no cheap count — never faked as 0. */
  options: { value: string; count?: number }[]
  selected: string[]
  onToggle: (value: string) => void
  format?: (value: string) => string
}) {
  const [needle, setNeedle] = useState('')

  const matches = useMemo(() => {
    const query = needle.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => format(option.value).toLowerCase().includes(query))
  }, [needle, options, format])

  const summary = selected.length ? `${label} · ${selected.length}` : label

  return (
    <Menu label={<span className={selected.length ? 'text-signal' : ''}>{summary}</span>}>
      {() => (
        <>
          {options.length > 8 ? (
            <div className="border-b border-rule p-2">
              <input
                type="text"
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                placeholder={`Filter ${label.toLowerCase()}`}
                aria-label={`Filter the ${label.toLowerCase()} list`}
                className={INPUT}
              />
            </div>
          ) : null}

          {matches.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-ink-faint">Nothing matches.</p>
          ) : (
            matches.map((option) => (
              <MenuCheck
                key={option.value}
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
                label={format(option.value)}
                count={option.count}
              />
            ))
          )}
        </>
      )}
    </Menu>
  )
}

export function FilterBar({
  filters,
  facets,
  onChange,
}: {
  filters: LeadFilters
  facets: LeadFacets
  /** Patches the filter set. Page always resets — a filter change is a new question. */
  onChange: (patch: Partial<LeadFilters>) => void
}) {
  const [query, setQuery] = useState(filters.q)

  // Typed characters must not each become a navigation. The field stays
  // instant locally and the URL catches up once he stops.
  useEffect(() => {
    if (query === filters.q) return
    const timer = setTimeout(() => onChange({ q: query }), 250)
    return () => clearTimeout(timer)
  }, [query, filters.q, onChange])

  /*
   * A view applied from elsewhere has to be able to clear this field.
   *
   * Adjusted during render, not in an effect: the debounce above compares
   * against `filters.q`, so a frame where the two disagree would schedule a
   * navigation back to the text the view just replaced.
   */
  const [lastApplied, setLastApplied] = useState(filters.q)
  if (lastApplied !== filters.q) {
    setLastApplied(filters.q)
    setQuery(filters.q)
  }

  const active = activeFilterCount(filters)
  const followUpLabel = filters.followUp
    ? (FOLLOW_UP_FILTERS.find((entry) => entry.key === filters.followUp)?.label ?? 'Follow-up')
    : 'Follow-up'

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-rule px-2 py-2 md:px-3">
      <div className="relative min-w-[10rem] flex-1 md:max-w-xs">
        <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the book"
          aria-label="Search saved leads by name"
          // What `/` reaches for. One attribute, so the key needs no knowledge
          // of which surface it is on or what that surface calls its search.
          {...{ [SEARCH_ATTRIBUTE]: '' }}
          className={`${INPUT} pl-8`}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-data text-micro text-ink-faint"
        >
          /
        </span>
      </div>

      <FacetMenu
        label="Status"
        options={facets.statuses.map((entry) => ({ value: entry.value, count: entry.count }))}
        selected={filters.status}
        onToggle={(value) => onChange({ status: toggle(filters.status, value as LeadStatus) })}
      />

      <FacetMenu
        label="List"
        options={facets.lists.map((list) => ({ value: list.id, count: list.count }))}
        selected={filters.listIds}
        onToggle={(value) => onChange({ listIds: toggle(filters.listIds, value) })}
        format={(id) => facets.lists.find((list) => list.id === id)?.name ?? 'Unknown list'}
      />

      <FacetMenu
        label="City"
        options={facets.cities}
        selected={filters.cities}
        onToggle={(value) => onChange({ cities: toggle(filters.cities, value) })}
      />

      <FacetMenu
        label="Category"
        options={facets.categories}
        selected={filters.categories}
        onToggle={(value) => onChange({ categories: toggle(filters.categories, value) })}
        format={formatPlaceType}
      />

      <FacetMenu
        label="Audit"
        options={AUDIT_FILTERS.map((entry) => ({ value: entry.key }))}
        selected={filters.audit}
        onToggle={(value) => onChange({ audit: toggle(filters.audit, value as AuditFilter) })}
        format={(key) => AUDIT_FILTERS.find((entry) => entry.key === key)?.label ?? key}
      />

      <Menu
        label={
          <span className={filters.followUp ? 'text-signal' : ''}>{followUpLabel}</span>
        }
        width="w-48"
      >
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                onChange({ followUp: null })
                close()
              }}
            >
              Any
            </MenuItem>
            {FOLLOW_UP_FILTERS.map((entry) => (
              <MenuItem
                key={entry.key}
                onClick={() => {
                  onChange({ followUp: entry.key as FollowUpFilter })
                  close()
                }}
              >
                {entry.label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      <Menu
        label={
          <span className={filters.scoreMin !== null || filters.scoreMax !== null ? 'text-signal' : ''}>
            {filters.scoreMin !== null || filters.scoreMax !== null
              ? `Score ${filters.scoreMin ?? 0}–${filters.scoreMax ?? 100}`
              : 'Score'}
          </span>
        }
        width="w-60"
      >
        {() => (
          <div className="p-2">
            <MenuLabel>Score range</MenuLabel>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={filters.scoreMin ?? ''}
                onChange={(event) =>
                  onChange({ scoreMin: event.target.value === '' ? null : Number(event.target.value) })
                }
                placeholder="0"
                aria-label="Lowest score"
                className={INPUT}
              />
              <span aria-hidden="true" className="text-ink-faint">
                –
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={filters.scoreMax ?? ''}
                onChange={(event) =>
                  onChange({ scoreMax: event.target.value === '' ? null : Number(event.target.value) })
                }
                placeholder="100"
                aria-label="Highest score"
                className={INPUT}
              />
            </div>
            {/*
              Said plainly rather than discovered: nothing scores leads yet, so
              a range filter would silently empty the table and look broken.
            */}
            <p className="mt-2 text-sm text-ink-faint">
              Leads are unscored until the scoring criteria are decided. This
              filter will exclude everything until then.
            </p>
          </div>
        )}
      </Menu>

      {active > 0 ? (
        <CommandButton
          type="button"
          variant="quiet"
          onClick={() =>
            onChange({
              q: '',
              status: [],
              listIds: [],
              cities: [],
              categories: [],
              scoreMin: null,
              scoreMax: null,
              audit: [],
              followUp: null,
            })
          }
        >
          <IconClose className="size-3" />
          Clear {active}
        </CommandButton>
      ) : (
        <span className="label flex items-center gap-1.5 text-ink-ghost">
          <IconFilter className="size-3.5" />
          <span className="text-ink-faint">No filters</span>
        </span>
      )}
    </div>
  )
}
