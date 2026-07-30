import 'server-only'

import { getProvider } from '@/lib/providers'
import { BudgetExceededError, type CostEvent, type ProviderContext } from '@/lib/providers/types'
import { createServiceClient } from '@/lib/supabase/server'
import type { BudgetState } from '@/lib/search/types'

/*
 * The ceiling, and the arithmetic behind it.
 *
 * "Show me what I'm spending" and "stop me spending it" are the same problem
 * read twice, so they share one module. The rules:
 *
 *   - The ledger is authoritative. Nothing here trusts a number the client sent
 *     or a total the UI kept; every figure is a sum over `api_usage`.
 *   - The check happens BEFORE the request. A ceiling enforced afterwards is a
 *     receipt, not a limit.
 *   - The free monthly allowance is part of the price. Google gives 1,000 Text
 *     Search Enterprise calls a month; a guard that ignored them would refuse
 *     to spend money that was never going to be spent.
 */

export type { BudgetState }

interface UsageRow {
  sku: string
  units: number
  list_usd: number
  billed_usd: number
}

function currentMonth(): string {
  // Google's billing months are UTC; the operator's timezone is irrelevant here.
  return new Date().toISOString().slice(0, 7)
}

async function loadUsage() {
  const supabase = createServiceClient()

  const [usage, settings] = await Promise.all([
    supabase.rpc('api_usage_month_to_date'),
    supabase.from('app_settings').select('monthly_ceiling_usd').eq('id', true).single(),
  ])

  if (usage.error) throw new Error(`Could not read API usage: ${usage.error.message}`)
  if (settings.error) throw new Error(`Could not read settings: ${settings.error.message}`)

  const rows = ((usage.data ?? []) as UsageRow[]).map((row) => ({
    sku: row.sku,
    units: Number(row.units),
    listUsd: Number(row.list_usd),
    billedUsd: Number(row.billed_usd),
  }))

  return {
    rows,
    ceilingUsd: Number(settings.data.monthly_ceiling_usd),
  }
}

export async function getBudgetState(): Promise<BudgetState> {
  const { rows, ceilingUsd } = await loadUsage()
  const rateCard = getProvider().rateCard

  const monthToDateUsd = rows.reduce((sum, row) => sum + row.billedUsd, 0)
  const monthToDateListUsd = rows.reduce((sum, row) => sum + row.listUsd, 0)

  /*
   * Every SKU with spend, plus every SKU the operator could still hit. Showing
   * only what has been used would hide the fact that the first Enterprise
   * search of the month is free — which is the number he most wants to see.
   */
  const skus = new Set([...rows.map((row) => row.sku), ...Object.keys(rateCard)])

  const bySku = [...skus]
    .map((sku) => {
      const used = rows.find((row) => row.sku === sku)
      const rate = rateCard[sku]
      const allowance = rate?.freeUnitsPerMonth ?? 0

      return {
        sku,
        label: rate?.label ?? sku,
        units: used?.units ?? 0,
        billedUsd: used?.billedUsd ?? 0,
        freeUnitsRemaining: Number.isFinite(allowance)
          ? Math.max(0, allowance - (used?.units ?? 0))
          : null,
      }
    })
    .filter((row) => row.units > 0 || (row.freeUnitsRemaining ?? 0) > 0)
    .sort((a, b) => b.billedUsd - a.billedUsd || a.label.localeCompare(b.label))

  return {
    ceilingUsd,
    monthToDateUsd,
    monthToDateListUsd,
    remainingUsd: Math.max(0, ceilingUsd - monthToDateUsd),
    exhausted: monthToDateUsd >= ceilingUsd,
    month: currentMonth(),
    // Priced with an empty query: every discovery run shares one field mask, so
    // the SKU is a property of the provider, not of what was typed.
    discoverySku: getProvider().estimateSearch({ query: '' }).sku,
    bySku,
  }
}

export async function setMonthlyCeiling(usd: number): Promise<BudgetState> {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error('The monthly ceiling must be zero or more.')
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('app_settings')
    .update({ monthly_ceiling_usd: usd })
    .eq('id', true)

  if (error) throw new Error(`Could not save the ceiling: ${error.message}`)
  return getBudgetState()
}

/* ------------------------------------------------------------------------- *
 * The guard
 * ------------------------------------------------------------------------- */

/**
 * A spend guard bound to one search run.
 *
 * State is read once at construction and then maintained in memory as calls are
 * authorised, so a six-page search costs one budget query rather than six. That
 * is safe here for a structural reason, not a lucky one: Lead Engine has
 * exactly one operator, so there is no second run racing this one toward the
 * ceiling. The ledger write itself is still per call and still durable.
 */
export class SpendGuard implements ProviderContext {
  #ceilingUsd: number
  #billedUsd: number
  #unitsBySku: Map<string, number>
  #searchId: string | null
  #events: CostEvent[] = []
  #spentUsd = 0
  #requests = 0

  private constructor(init: {
    ceilingUsd: number
    billedUsd: number
    unitsBySku: Map<string, number>
    searchId: string | null
  }) {
    this.#ceilingUsd = init.ceilingUsd
    this.#billedUsd = init.billedUsd
    this.#unitsBySku = init.unitsBySku
    this.#searchId = init.searchId
  }

  static async create(searchId: string | null = null): Promise<SpendGuard> {
    const { rows, ceilingUsd } = await loadUsage()
    return new SpendGuard({
      ceilingUsd,
      billedUsd: rows.reduce((sum, row) => sum + row.billedUsd, 0),
      unitsBySku: new Map(rows.map((row) => [row.sku, row.units])),
      searchId,
    })
  }

  /** Set once the `searches` row exists, so its calls are attributable to it. */
  attachSearch(searchId: string) {
    this.#searchId = searchId
  }

  /** Billed spend for this run only — the "this search cost" figure. */
  get spentUsd() {
    return this.#spentUsd
  }
  get requests() {
    return this.#requests
  }
  get events(): readonly CostEvent[] {
    return this.#events
  }
  get monthToDateUsd() {
    return this.#billedUsd
  }
  get ceilingUsd() {
    return this.#ceilingUsd
  }

  /**
   * What this event would actually cost, given what the month has already used.
   * Pure — it reads the counters but never moves them, so `authorizeSpend` and
   * `recordSpend` agree without having to pass state between themselves.
   */
  #project(event: CostEvent) {
    const allowance = getProvider().rateCard[event.sku]?.freeUnitsPerMonth ?? 0
    const usedUnits = this.#unitsBySku.get(event.sku) ?? 0
    const freeRemaining = Number.isFinite(allowance) ? Math.max(0, allowance - usedUnits) : event.units

    const freeUnits = Math.min(event.units, freeRemaining)
    const billedUnits = event.units - freeUnits

    return { freeUnits, billedUnits, billedUsd: billedUnits * event.unitPriceUsd }
  }

  authorizeSpend = (pending: CostEvent) => {
    const { billedUsd } = this.#project(pending)

    // A free call is always allowed: refusing it would protect nothing.
    if (billedUsd === 0) return

    if (this.#billedUsd + billedUsd > this.#ceilingUsd) {
      throw new BudgetExceededError(this.#billedUsd, this.#ceilingUsd)
    }
  }

  recordSpend = async (spent: CostEvent) => {
    const { freeUnits, billedUsd } = this.#project(spent)

    this.#unitsBySku.set(spent.sku, (this.#unitsBySku.get(spent.sku) ?? 0) + spent.units)
    this.#billedUsd += billedUsd
    this.#spentUsd += billedUsd
    this.#requests += 1
    this.#events.push(spent)

    const supabase = createServiceClient()
    const { error } = await supabase.from('api_usage').insert({
      provider: spent.sku.split('.')[0],
      sku: spent.sku,
      units: spent.units,
      unit_price_usd: spent.unitPriceUsd,
      list_amount_usd: spent.listAmountUsd,
      free_units: freeUnits,
      billed_amount_usd: billedUsd,
      search_id: this.#searchId,
    })

    /*
     * A failed ledger write must not fail the search — the operator already has
     * the results and Google has already charged for them. But it must be loud:
     * a silently short ledger is a ceiling that stops working.
     */
    if (error) {
      console.error('[cost] failed to record API usage', {
        sku: spent.sku,
        searchId: this.#searchId,
        error: error.message,
      })
    }
  }
}
