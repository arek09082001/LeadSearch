import 'server-only'

import { isAssistantSku, skuFor, unitPriceUsd } from '@/lib/assistant/anthropic/pricing'
import type { AssistantModel } from '@/lib/assistant/anthropic/pricing'
import { AssistantError } from '@/lib/assistant/types'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * The ceiling on model spend, and the ledger it is read from.
 *
 * `monthly_ceiling_usd` is 0 and is meant to be. That default is a posture about
 * GOOGLE: Places gives 1,000 free Text Searches a month, so a zero ceiling still
 * buys around twenty thousand businesses and then stops dead before an invoice
 * starts. There is no equivalent here. Every token is billed from the first one,
 * so the same number applied to a model would not be a cautious default — it
 * would mean `ASSISTANT_PROVIDER=anthropic` is a variable that can be set and
 * never works, which is worse than no ceiling at all because it looks like a
 * bug.
 *
 * SO THERE ARE TWO CEILINGS AND THEY ARE DISJOINT. `monthly_ceiling_usd` bounds
 * Google; `assistant_ceiling_usd` bounds the models; each is checked against its
 * own half of the ledger and neither can be spent by the other. That is the
 * "second, explicit cap" rather than the "check applies here too" reading, and
 * the reason is that the operator has two different questions — how much Google
 * may cost him this month, and how much he is willing to pay for the assistant —
 * and one number cannot answer both without one of them silently rationing the
 * other. A month spent briefing calls must not be the reason a search is refused.
 *
 * WHAT IS NOT SEPARATE IS THE LEDGER. Every model call is written to `api_usage`
 * like every Google call, with its own SKU, so the running total on screen is
 * the whole bill and not the Google part of it.
 *
 * THE CHECK STILL HAPPENS BEFORE THE REQUEST, which is the rule `lib/search/cost`
 * states and the one that makes a ceiling a limit rather than a receipt. A model
 * makes that awkward: the output half of the bill does not exist until the
 * answer does. So the projection is the WORST CASE — the prompt as measured plus
 * `max_tokens` of output, all of it at list — and what is recorded afterwards is
 * what actually happened. The guard therefore refuses slightly early and never
 * slightly late, which is the direction a ceiling should be wrong in.
 */

/**
 * The ceiling refused a model call.
 *
 * An `AssistantError` rather than a `BudgetExceededError` because of what the
 * callers do with each: the Google one stops a search, and this one must not
 * stop a phone call. `types.ts` states the contract — none of the three
 * interfaces is load-bearing — and the tips route already turns an
 * `AssistantError` into a quiet "unavailable" rather than an error on screen
 * mid-sentence.
 */
export class AssistantBudgetExceededError extends AssistantError {
  readonly monthToDateUsd: number
  readonly ceilingUsd: number

  constructor(stage: AssistantError['stage'], monthToDateUsd: number, ceilingUsd: number) {
    super(
      stage,
      `Assistant ceiling reached: $${monthToDateUsd.toFixed(2)} of $${ceilingUsd.toFixed(2)} this month. ` +
        `Raise it beside the running total, or unset ASSISTANT_PROVIDER to brief from fixtures.`,
    )
    this.name = 'AssistantBudgetExceededError'
    this.monthToDateUsd = monthToDateUsd
    this.ceilingUsd = ceilingUsd
  }
}

interface UsageRow {
  sku: string
  billed_usd: number
}

/**
 * Model spend this month, and what it is allowed to reach.
 *
 * Its own query rather than a share of `lib/search/cost`'s, because the two ask
 * different questions of the same table: that one wants every SKU and Google's
 * free allowances, this one wants one sum over the rows whose SKU is ours. The
 * duplication is one RPC call; the coupling it avoids is a guard that could not
 * be reasoned about without reading the search code.
 */
async function loadAssistantBudget(): Promise<{ billedUsd: number; ceilingUsd: number }> {
  const supabase = createServiceClient()

  const [usage, settings] = await Promise.all([
    supabase.rpc('api_usage_month_to_date'),
    supabase.from('app_settings').select('assistant_ceiling_usd').eq('id', true).single(),
  ])

  if (usage.error) throw new Error(`Could not read API usage: ${usage.error.message}`)
  if (settings.error) throw new Error(`Could not read settings: ${settings.error.message}`)

  const billedUsd = ((usage.data ?? []) as UsageRow[])
    .filter((row) => isAssistantSku(row.sku))
    .reduce((sum, row) => sum + Number(row.billed_usd), 0)

  return { billedUsd, ceilingUsd: Number(settings.data.assistant_ceiling_usd) }
}

/**
 * What a request will cost at worst, before it is made.
 *
 * The prompt is measured rather than counted. Counting it properly means a
 * second round trip to `/v1/messages/count_tokens`, and this runs on the path
 * where the operator is holding a phone — a free request that costs 200ms is
 * not free on this screen. Three characters to the token is deliberately mean:
 * German compounds tokenize worse than English prose, and a projection that is
 * too high refuses too early, which is the safe way to be wrong.
 */
const CHARS_PER_TOKEN = 3

export function estimateInputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** The token counts a response reports back. Named so the SDK shape stays in one file. */
export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * One assistant request's worth of ceiling and ledger.
 *
 * Created per request rather than per run, unlike `SpendGuard`: a search makes
 * six calls in a row and reads the ledger once, and an assistant makes exactly
 * one. Reading state per request also means the ceiling reflects the tip that
 * was billed thirty seconds ago on the same call.
 */
export class AssistantSpendGuard {
  #billedUsd: number
  #ceilingUsd: number
  #callId: string | null

  private constructor(init: { billedUsd: number; ceilingUsd: number; callId: string | null }) {
    this.#billedUsd = init.billedUsd
    this.#ceilingUsd = init.ceilingUsd
    this.#callId = init.callId
  }

  static async create(callId: string | null = null): Promise<AssistantSpendGuard> {
    const { billedUsd, ceilingUsd } = await loadAssistantBudget()
    return new AssistantSpendGuard({ billedUsd, ceilingUsd, callId })
  }

  get monthToDateUsd() {
    return this.#billedUsd
  }
  get ceilingUsd() {
    return this.#ceilingUsd
  }

  /**
   * Refuse now, or let the request happen.
   *
   * Throws before anything is sent. There is no free-call exemption of the kind
   * the Google guard has, because there is no free call: a zero-cost model
   * request would be one that sent and returned nothing.
   */
  authorize(pending: {
    stage: AssistantError['stage']
    model: AssistantModel
    inputTokens: number
    maxOutputTokens: number
  }): void {
    const worstCase =
      pending.inputTokens * unitPriceUsd(pending.model, 'input') +
      pending.maxOutputTokens * unitPriceUsd(pending.model, 'output')

    if (this.#billedUsd + worstCase > this.#ceilingUsd) {
      throw new AssistantBudgetExceededError(pending.stage, this.#billedUsd, this.#ceilingUsd)
    }
  }

  /**
   * What it actually cost, into the ledger, one row per direction.
   *
   * WRITTEN WHETHER OR NOT THE ANSWER WAS USABLE. A response that failed
   * validation was still generated and is still billed, exactly as `api_usage`
   * records a Google 500 — a ledger that only counted the calls that went well
   * would understate the bill by precisely the calls worth knowing about.
   *
   * A FAILED WRITE DOES NOT FAIL THE CALL, for the reason the Google ledger
   * gives: the money is already spent and the operator already has his briefing.
   * But it is loud, because a silently short ledger is a ceiling that has
   * stopped working.
   */
  async record(model: AssistantModel, usage: TokenUsage): Promise<void> {
    /*
     * Cache tokens folded into the input SKU at the input price.
     *
     * Nothing here sends `cache_control`, so both are zero today. If that
     * changes, this counts a cache read at full input price — which overstates
     * it by about ten times rather than losing it, and an overstated line in the
     * cost readout is a thing somebody notices and fixes.
     */
    const inputTokens =
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0)

    const rows = (
      [
        ['input', inputTokens],
        ['output', usage.output_tokens],
      ] as const
    )
      .filter(([, units]) => units > 0)
      .map(([direction, units]) => {
        const price = unitPriceUsd(model, direction)
        const amount = units * price
        return {
          provider: 'anthropic',
          sku: skuFor(model, direction),
          units,
          unit_price_usd: price,
          list_amount_usd: amount,
          // No allowance to absorb anything: see `assistantRateCard`.
          free_units: 0,
          billed_amount_usd: amount,
          call_id: this.#callId,
        }
      })

    if (!rows.length) return

    for (const row of rows) this.#billedUsd += row.billed_amount_usd

    const supabase = createServiceClient()
    const { error } = await supabase.from('api_usage').insert(rows)

    if (error) {
      console.error('[assistant] failed to record model usage', {
        model,
        callId: this.#callId,
        error: error.message,
      })
    }
  }
}
