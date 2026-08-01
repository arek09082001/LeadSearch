import type { RateCard } from '@/lib/providers/types'

/*
 * What the models cost, and which SKU each one bills to.
 *
 * NOT `server-only`. This file holds published prices and no key, and the cost
 * readout is a client component that has to be able to name a SKU — the same
 * reason `lib/search/types.ts` keeps `BudgetState` away from the module that
 * computes it.
 *
 * THREE MODELS ARE NAMED HERE, ONE PER JOB, and the split is a decision about
 * what each job is for rather than about what each model costs:
 *
 *   suggest    Haiku. It is already the exception — `triggers.ts` answers the
 *              normal case in the tab, with no network and no bill — so the only
 *              time this runs is when the operator pressed a key mid-sentence
 *              and is waiting. Latency is the whole of the requirement.
 *
 *   generate   Sonnet. Once per conversation, read in the ten seconds before the
 *   summarise  line connects or the ten after it drops. Quality beats speed, and
 *              at one call per conversation the price difference is noise beside
 *              the cost of a briefing the operator does not trust.
 *
 * TOKENS ARE THE UNIT, not requests. Google bills per request and its SKUs say
 * so; a model bills per token in two directions at two prices, and a ledger that
 * recorded "one call" would be a ledger that could not tell a twelve-word tip
 * from a briefing. `api_usage.units` is an integer and a token count is one.
 *
 * TWO SKUS PER MODEL, input and output, because they are priced four to five
 * times apart and a blended rate would be a number nobody could check against an
 * invoice. Nothing here sends `cache_control`, so cache reads and cache writes
 * are always zero; `usage.ts` folds them into the input SKU if that ever stops
 * being true, which overstates rather than hides them.
 */

/** The model that answers each of the three questions. Read at call time. */
export const ASSISTANT_MODELS = {
  /** Mid-call, while the operator waits. Fast is the requirement. */
  tip: 'claude-haiku-4-5',
  /** Before the phone rings. Once per conversation. */
  briefing: 'claude-sonnet-5',
  /** After the line drops. Once per conversation. */
  summary: 'claude-sonnet-5',
} as const

export type AssistantJob = keyof typeof ASSISTANT_MODELS
export type AssistantModel = (typeof ASSISTANT_MODELS)[AssistantJob]

/** The two directions a token can travel, and therefore be billed in. */
export type TokenDirection = 'input' | 'output'

interface ModelPrice {
  label: string
  /** USD per million tokens, list. */
  inputPerMTok: number
  outputPerMTok: number
  /**
   * Introductory pricing, while it lasts.
   *
   * Encoded rather than commented because the ledger stores the price that was
   * charged on the day, and a rate card that quoted the standard price through
   * an introductory window would put a number in the cost readout that the
   * invoice disagrees with. `until` is the last day the discount applies, UTC —
   * the same clock `billing_month` is generated in.
   */
  intro?: { inputPerMTok: number; outputPerMTok: number; until: string }
}

const MODEL_PRICES: Record<AssistantModel, ModelPrice> = {
  'claude-sonnet-5': {
    label: 'Claude Sonnet 5',
    inputPerMTok: 3,
    outputPerMTok: 15,
    intro: { inputPerMTok: 2, outputPerMTok: 10, until: '2026-08-31' },
  },
  'claude-haiku-4-5': {
    label: 'Claude Haiku 4.5',
    inputPerMTok: 1,
    outputPerMTok: 5,
  },
}

/**
 * The SKU a model's tokens bill to. `anthropic.claude-sonnet-5.output`.
 *
 * The provider id is the first segment because `SpendGuard.recordSpend` splits
 * on it to fill `api_usage.provider`, and because a cost report that could not
 * separate Google from Anthropic would be answering the wrong question.
 */
export function skuFor(model: AssistantModel, direction: TokenDirection): string {
  return `anthropic.${model}.${direction}`
}

function priceOn(price: ModelPrice, day: string): { input: number; output: number } {
  const intro = price.intro && day <= price.intro.until ? price.intro : null
  return {
    input: (intro?.inputPerMTok ?? price.inputPerMTok) / 1_000_000,
    output: (intro?.outputPerMTok ?? price.outputPerMTok) / 1_000_000,
  }
}

/** Today, UTC, as `YYYY-MM-DD`. The zone billing months are cut in. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** List price per token, in USD, for one model and direction. */
export function unitPriceUsd(
  model: AssistantModel,
  direction: TokenDirection,
  day: string = today(),
): number {
  return priceOn(MODEL_PRICES[model], day)[direction]
}

/**
 * The assistant's published prices, in the shape the cost ledger already reads.
 *
 * A FUNCTION RATHER THAN A CONSTANT, unlike `GooglePlacesProvider.rateCard`,
 * because one of these prices expires on a date. A constant built at import
 * would hold whatever was true when the server booted, which on a long-lived
 * process is whatever was true the day it was deployed.
 *
 * `freeUnitsPerMonth` is 0 for every SKU and that is not a placeholder: there is
 * no free tier here. Google's 1,000 free Text Searches a month are why a $0
 * ceiling is a usable posture for search; the absence of an equivalent is why
 * model spend needs a ceiling of its own. See `assistant_ceiling_usd`.
 */
export function assistantRateCard(day: string = today()): RateCard {
  const card: RateCard = {}

  for (const [model, price] of Object.entries(MODEL_PRICES) as [AssistantModel, ModelPrice][]) {
    const resolved = priceOn(price, day)
    card[skuFor(model, 'input')] = {
      label: `${price.label} — input`,
      unitPriceUsd: resolved.input,
      freeUnitsPerMonth: 0,
    }
    card[skuFor(model, 'output')] = {
      label: `${price.label} — output`,
      unitPriceUsd: resolved.output,
      freeUnitsPerMonth: 0,
    }
  }

  return card
}

/**
 * Whether a SKU is one of ours.
 *
 * Used by the cost readout to keep the two halves of the bill apart on screen
 * without either of them having to be enumerated there.
 */
export function isAssistantSku(sku: string): boolean {
  return sku.startsWith('anthropic.')
}
