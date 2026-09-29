'use client'

import { useState } from 'react'

import { IconCeiling } from '@/components/icons'
import { CommandButton } from '@/components/ui/command-button'
import type { BudgetState } from '@/lib/search/types'

/*
 * What this is costing, in figures that never move around.
 *
 *   THIS SEARCH   what the run in progress has spent
 *   MONTH         billed spend, everything, the whole bill
 *   GOOGLE        the provider half, against the ceiling that bounds it
 *   ASSISTANT     the model half, against the ceiling that bounds that
 *   FREE LEFT     calls still inside Google's monthly allowance
 *
 * A ruled strip of labelled figures, not stat tiles: this is a readout on an
 * instrument, and it has to stay legible in peripheral vision while the
 * operator is reading rows. Every number is `data` so the columns hold still as
 * the digits change.
 *
 * MONTH IS THE WHOLE BILL AND THE TWO BELOW IT ARE ITS HALVES. That split is not
 * decoration: the ceilings are disjoint — Google's spend cannot refuse a
 * briefing and a month of briefings cannot refuse a search — so a single figure
 * shown against a single ceiling would be wrong in whichever direction was
 * worse. The total is what the invoice will say; each half is what its own
 * ceiling is actually measuring.
 *
 * ASSISTANT IS HIDDEN UNTIL IT HAS SOMETHING TO SAY. With `ASSISTANT_PROVIDER`
 * unset the assistant answers from fixtures and costs nothing, which is the
 * ordinary state and does not deserve a permanent zero on the instrument.
 *
 * FREE LEFT is the figure that matters most on a $0 Google ceiling, which is the
 * default: the operator is spending an allowance, not money, and needs to see it
 * draining before it stops him mid-session.
 */

function usd(amount: number): string {
  // Sub-cent precision, because a single Text Search call is $0.035 and
  // rounding it to $0.04 would make the arithmetic on screen look wrong.
  return amount < 1 && amount > 0
    ? `$${amount.toFixed(3)}`
    : `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Figure({
  label,
  value,
  tone = 'ink',
  title,
}: {
  label: string
  value: string
  tone?: 'ink' | 'dim' | 'signal' | 'alert' | 'live'
  title?: string
}) {
  const TONES = {
    ink: 'text-ink',
    dim: 'text-ink-dim',
    signal: 'text-signal',
    alert: 'text-alert',
    live: 'text-live',
  } as const

  return (
    <div className="flex shrink-0 items-baseline gap-1.5" title={title}>
      <span className="label text-ink-faint">{label}</span>
      <span className={`font-data text-sm ${TONES[tone]}`}>{value}</span>
    </div>
  )
}

export function CostReadout({
  budget,
  searchCostUsd,
  requests,
  estimateUsd,
  onCeilingChange,
}: {
  budget: BudgetState
  searchCostUsd: number
  requests: number
  /** Worst case for the run in progress, shown until it is overtaken by actuals. */
  estimateUsd: number | null
  onCeilingChange: (budget: BudgetState) => void
}) {
  /*
   * Which ceiling is being edited, or none. A single editor bound to a field
   * rather than two of them: they are the same press with a different target,
   * and two inputs open at once would invite the operator to think one Set
   * saves both. It does not — see the budget route.
   */
  const [editing, setEditing] = useState<null | 'monthlyCeilingUsd' | 'assistantCeilingUsd'>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** True when the assistant is costing money, or has been told it may. */
  const assistantInPlay = budget.assistantCeilingUsd > 0 || budget.assistantMonthToDateUsd > 0

  function open(field: 'monthlyCeilingUsd' | 'assistantCeilingUsd') {
    setDraft(
      String(field === 'monthlyCeilingUsd' ? budget.ceilingUsd : budget.assistantCeilingUsd),
    )
    setError(null)
    setEditing(field)
  }

  function close() {
    setEditing(null)
    setError(null)
  }

  /*
   * The allowance a search actually draws from — named by the server, not
   * guessed by picking the smallest number on the card. Several SKUs share the
   * same 1,000-call allowance, so "whichever has least left" would happily
   * report Place Details Enterprise + Atmosphere to an operator who has never
   * made such a call. Falling back to the tightest metered SKU only matters if
   * a provider stops declaring one.
   */
  const allowance =
    budget.bySku.find((sku) => sku.sku === budget.discoverySku) ??
    budget.bySku
      .filter((sku) => sku.freeUnitsRemaining !== null)
      .sort((a, b) => (a.freeUnitsRemaining ?? 0) - (b.freeUnitsRemaining ?? 0))[0]

  async function save() {
    if (!editing) return

    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // One field per request, named. The route leaves the other alone.
        body: JSON.stringify({ [editing]: Number(draft) }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not save the ceiling.')
        return
      }
      onCeilingChange(body as BudgetState)
      setEditing(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-rule bg-panel px-2 py-1.5 md:px-3">
      <Figure
        label="This search"
        value={usd(searchCostUsd)}
        tone={searchCostUsd > 0 ? 'ink' : 'dim'}
        title={
          requests
            ? `${requests} billable request${requests === 1 ? '' : 's'} so far`
            : 'Nothing billable yet this run'
        }
      />

      {estimateUsd !== null && searchCostUsd < estimateUsd ? (
        <Figure
          label="Max"
          value={usd(estimateUsd)}
          tone="dim"
          title="Worst case if every page is fetched and none is free"
        />
      ) : null}

      <span aria-hidden="true" className="hidden h-3 w-px bg-rule-strong sm:block" />

      <Figure
        label={`Month ${budget.month}`}
        value={usd(budget.monthToDateUsd)}
        tone={budget.monthToDateUsd > 0 ? 'ink' : 'dim'}
        title={`Everything billed this month, Google and models both. List value before the free allowance: ${usd(budget.monthToDateListUsd)}`}
      />

      <Figure
        label="Google"
        value={`${usd(budget.providerMonthToDateUsd)} / ${usd(budget.ceilingUsd)}`}
        tone={budget.exhausted ? 'alert' : budget.providerMonthToDateUsd > 0 ? 'ink' : 'dim'}
        title="Provider spend against the ceiling that bounds it. Model spend is counted separately and cannot exhaust this."
      />

      {assistantInPlay ? (
        <Figure
          label="Assistant"
          value={`${usd(budget.assistantMonthToDateUsd)} / ${usd(budget.assistantCeilingUsd)}`}
          tone={
            budget.assistantExhausted
              ? 'alert'
              : budget.assistantMonthToDateUsd > 0
                ? 'ink'
                : 'dim'
          }
          title="What the model-backed assistant has cost this month — briefings, tips and summaries — against its own ceiling."
        />
      ) : null}

      {allowance && allowance.freeUnitsRemaining !== null ? (
        <Figure
          label="Free left"
          value={`${allowance.freeUnitsRemaining.toLocaleString('en-US')} calls`}
          tone={
            allowance.freeUnitsRemaining === 0
              ? 'alert'
              : allowance.freeUnitsRemaining < 50
                ? 'signal'
                : 'live'
          }
          title={`${allowance.label} — Google's free monthly allowance. Each call returns up to 20 businesses.`}
        />
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {editing ? (
          <>
            <label className="flex items-center gap-1.5">
              <span className="label text-ink-faint">
                {editing === 'monthlyCeilingUsd' ? 'Google' : 'Assistant'}&nbsp;$
              </span>
              <input
                type="number"
                min={0}
                max={10000}
                step="0.01"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void save()
                  }
                  if (event.key === 'Escape') close()
                }}
                className="w-20 border border-rule bg-ground px-1.5 py-1 text-right font-data text-sm text-ink outline-none focus:border-signal"
              />
            </label>
            <CommandButton type="button" variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving' : 'Set'}
            </CommandButton>
            <CommandButton type="button" variant="quiet" onClick={close}>
              Cancel
            </CommandButton>
          </>
        ) : (
          <>
            <CommandButton
              type="button"
              variant="quiet"
              onClick={() => open('monthlyCeilingUsd')}
              title="Set the hard monthly limit on Google spend"
            >
              <IconCeiling className="size-3.5" />
              Ceiling
            </CommandButton>
            <CommandButton
              type="button"
              variant="quiet"
              onClick={() => open('assistantCeilingUsd')}
              title="Set the hard monthly limit on model spend. Zero refuses every model call, which is the default."
            >
              <IconCeiling className="size-3.5" />
              Assistant
            </CommandButton>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="w-full text-sm text-alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
