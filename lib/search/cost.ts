import 'server-only'

import { assistantRateCard, isAssistantSku } from '@/lib/assistant/anthropic/pricing'
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
 *
 * ONE LEDGER, TWO CEILINGS, SINCE THE ASSISTANT LEARNED TO COST MONEY.
 *
 * Model spend is written to `api_usage` like everything else — the running total
 * on screen has to be the whole bill, not the Google part of it — but it is
 * bounded by `assistant_ceiling_usd` and enforced in `lib/assistant/anthropic/
 * spend.ts`, which is the only place that knows what a prompt weighs before it
 * is sent. See that file for why the two ceilings are disjoint rather than one.
 *
 * WHAT THAT COSTS THIS FILE is a filter it did not used to need. Every sum here
 * that feeds the GOOGLE ceiling now excludes the assistant's rows, because a
 * shared total would mean a month of briefings quietly refusing a search — the
 * exact coupling the second ceiling exists to prevent. The totals that feed the
 * SCREEN keep everything, because the operator is being told what he is
 * spending, not which subsystem spent it.
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
    supabase
      .from('app_settings')
      .select('monthly_ceiling_usd, assistant_ceiling_usd')
      .eq('id', true)
      .single(),
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
    assistantCeilingUsd: Number(settings.data.assistant_ceiling_usd),
  }
}

export async function getBudgetState(): Promise<BudgetState> {
  const { rows, ceilingUsd, assistantCeilingUsd } = await loadUsage()
  /*
   * Both rate cards, because the readout has to name both halves of the bill.
   * The assistant's is a function rather than a constant — one of its prices
   * expires on a date; see `assistantRateCard`.
   */
  const rateCard = { ...getProvider().rateCard, ...assistantRateCard() }

  const assistantRows = rows.filter((row) => isAssistantSku(row.sku))
  const providerRows = rows.filter((row) => !isAssistantSku(row.sku))

  // The screen's totals. Everything, because the operator is being told what he
  // is spending rather than which half of the app spent it.
  const monthToDateUsd = rows.reduce((sum, row) => sum + row.billedUsd, 0)
  const monthToDateListUsd = rows.reduce((sum, row) => sum + row.listUsd, 0)

  // The two ceilings' own totals, each over its own half of the ledger.
  const providerMonthToDateUsd = providerRows.reduce((sum, row) => sum + row.billedUsd, 0)
  const assistantMonthToDateUsd = assistantRows.reduce((sum, row) => sum + row.billedUsd, 0)

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
    /*
     * Against the GOOGLE half, not the total. `remainingUsd` and `exhausted` are
     * read as "will the next search be authorised", and the only thing that can
     * answer that is the ledger the Google guard checks — see the note at the
     * top. Subtracting model spend here would make a month of briefings look
     * like a search budget that had run out.
     */
    remainingUsd: Math.max(0, ceilingUsd - providerMonthToDateUsd),
    exhausted: providerMonthToDateUsd >= ceilingUsd,
    providerMonthToDateUsd,
    assistantCeilingUsd,
    assistantMonthToDateUsd,
    assistantExhausted: assistantMonthToDateUsd >= assistantCeilingUsd,
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

/**
 * The other ceiling: what the model-backed assistant may cost this month.
 *
 * A separate function rather than a second argument, because the two numbers are
 * set from two different places for two different reasons and neither press
 * should be able to move the other by omission.
 */
export async function setAssistantCeiling(usd: number): Promise<BudgetState> {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error('The assistant ceiling must be zero or more.')
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('app_settings')
    .update({ assistant_ceiling_usd: usd })
    .eq('id', true)

  if (error) throw new Error(`Could not save the assistant ceiling: ${error.message}`)
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
  #callId: string | null
  #events: CostEvent[] = []
  #spentUsd = 0
  #requests = 0

  private constructor(init: {
    ceilingUsd: number
    billedUsd: number
    unitsBySku: Map<string, number>
    searchId: string | null
    callId: string | null
  }) {
    this.#ceilingUsd = init.ceilingUsd
    this.#billedUsd = init.billedUsd
    this.#unitsBySku = init.unitsBySku
    this.#searchId = init.searchId
    this.#callId = init.callId
  }

  /**
   * `callId` is for the one billable request that is not part of a search: the
   * review fetch a briefing makes seconds before the phone is picked up. It is
   * what makes "what did that call cost" answerable about the whole call rather
   * than about its model half.
   */
  static async create(
    searchId: string | null = null,
    callId: string | null = null,
  ): Promise<SpendGuard> {
    const { rows, ceilingUsd } = await loadUsage()
    /*
     * The assistant's rows are excluded, and this is the line that keeps the two
     * ceilings disjoint. They are in the same table because the operator is
     * owed one running total; they are not in this sum because `monthly_ceiling_usd`
     * is a statement about what Google may cost, and a month of briefings must
     * never be the reason a search is refused.
     */
    const provider = rows.filter((row) => !isAssistantSku(row.sku))

    return new SpendGuard({
      ceilingUsd,
      billedUsd: provider.reduce((sum, row) => sum + row.billedUsd, 0),
      unitsBySku: new Map(provider.map((row) => [row.sku, row.units])),
      searchId,
      callId,
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
      call_id: this.#callId,
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
