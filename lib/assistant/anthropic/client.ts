import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { ASSISTANT_MODELS, type AssistantJob, type AssistantModel } from '@/lib/assistant/anthropic/pricing'
import { AssistantSpendGuard, estimateInputTokens } from '@/lib/assistant/anthropic/spend'
import { AssistantError } from '@/lib/assistant/types'
import { env } from '@/lib/env'

/*
 * The one place a key is held and the one place a request is made.
 *
 * `server-only`, and it is the first module in this folder that has to be: the
 * mock is importable from a bare node session on purpose, and everything above
 * this line in `anthropic/` is prices and prose. This file holds a credential,
 * so it must be impossible to bundle for a browser. The three routes that reach
 * it already run through `guard.ts`; this is the second lock, at the import.
 *
 * ONE FUNCTION, THREE CALLERS. `ask` is the whole of the transport: authorise,
 * send, record, parse, check. Writing it once is what keeps the three jobs from
 * drifting into three different opinions about what happens when a model
 * refuses, runs out of tokens, or answers something unusable — and each of those
 * is a thing that happens while the operator is holding a phone.
 *
 * IT NEVER THROWS SOMETHING RAW. Every failure leaves here as an `AssistantError`
 * with a stage on it, which is the shape `types.ts` promises every caller and
 * the reason a refused model degrades the screen instead of breaking it.
 */

/**
 * The client, rebuilt when the key changes and not otherwise.
 *
 * `lib/providers/index.ts` explains why the key is read at call time rather than
 * captured at construction: a process that outlives a rotated credential should
 * not keep using the old one. The SDK takes its key at construction, so the
 * memo is keyed on the key itself — which gets the same property without paying
 * for a new connection pool on every tip.
 */
let cached: { key: string; client: Anthropic } | null = null

function client(): Anthropic {
  const key = env.ANTHROPIC_API_KEY
  if (cached?.key !== key) {
    cached = {
      key,
      client: new Anthropic({
        apiKey: key,
        /*
         * Two rather than the SDK's default of two retries plus a long timeout.
         * Everything here happens with a phone in somebody's hand: the routes
         * cap at 30 seconds, and a request still retrying at second 25 has
         * already lost the moment it was for.
         */
        maxRetries: 1,
        timeout: 25_000,
      }),
    }
  }
  return cached.client
}

/**
 * How much room each job's answer gets.
 *
 * These are the enforced ceiling, not a target — `max_tokens` caps thinking and
 * text together, and it is also the output half of what the guard projects
 * before the request. Generous enough that a truncated briefing is a bug rather
 * than a Tuesday; small enough that the worst case is a number the operator
 * would recognise as the cost of one call.
 */
const MAX_TOKENS: Record<AssistantJob, number> = {
  tip: 200,
  briefing: 4_000,
  summary: 2_000,
}

/**
 * The depth each job thinks at.
 *
 * The tip does not think at all: Haiku is here because the operator is waiting
 * mid-sentence, and reasoning about twelve words would spend the only thing that
 * makes this path worth having. The other two think, because they run once per
 * conversation and are read as prose — but at `medium` rather than higher,
 * because the route gives them thirty seconds and a briefing that arrives after
 * the call has started is not a briefing.
 */
function thinkingFor(job: AssistantJob) {
  return job === 'tip'
    ? ({ type: 'disabled' } as const)
    : ({ type: 'adaptive' } as const)
}

interface Ask {
  job: AssistantJob
  stage: AssistantError['stage']
  system: string
  prompt: string
  /** A JSON schema. The API enforces it; `shapes.ts` checks what it cannot express. */
  schema: Record<string, unknown>
  /** The call this spend belongs to, so the ledger can answer "what did that call cost". */
  callId: string | null
  signal?: AbortSignal
}

/**
 * One structured answer, paid for and checked.
 *
 * Returns parsed JSON of an unknown shape on purpose. Turning it into a
 * `Briefing` is `shapes.ts`'s job, and keeping the two apart is what lets the
 * bounds a schema cannot state be argued about without reading any of this.
 */
export async function ask({
  job,
  stage,
  system,
  prompt,
  schema,
  callId,
  signal,
}: Ask): Promise<unknown> {
  const model: AssistantModel = ASSISTANT_MODELS[job]
  const maxTokens = MAX_TOKENS[job]

  const guard = await AssistantSpendGuard.create(callId)
  // Before the request. A ceiling enforced afterwards is a receipt.
  guard.authorize({
    stage,
    model,
    inputTokens: estimateInputTokens(system) + estimateInputTokens(prompt),
    maxOutputTokens: maxTokens,
  })

  let response
  try {
    response = await client().messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        thinking: thinkingFor(job),
        output_config: {
          format: { type: 'json_schema', schema },
          /*
           * Effort is a Sonnet-and-above control and Haiku rejects it, which is
           * the same shape of fact as a Google field mask deciding a SKU: a
           * property of the model, so it is decided beside the model rather
           * than at the call site.
           */
          ...(job === 'tip' ? {} : { effort: 'medium' as const }),
        },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    )
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new AssistantError(stage, `The assistant could not be reached: ${error.message}`, error.status)
    }
    // An abort is the surface throwing an answer away, which it is supposed to
    // do — see `AssistantContext.signal`. It arrives here as one error shape.
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AssistantError(stage, 'The assistant request was cancelled.')
    }
    throw new AssistantError(
      stage,
      error instanceof Error ? error.message : 'The assistant request failed.',
    )
  }

  /*
   * The ledger is written before the answer is judged.
   *
   * A response that fails validation was still generated and is still billed —
   * the same rule `api_usage` applies to a Google 500. Awaited rather than left
   * dangling: the guard reads the ledger fresh on the next request, and a write
   * still in flight when the next tip is authorised is a ceiling that undercounts
   * exactly when calls are coming fastest.
   */
  await guard.record(model, response.usage)

  if (response.stop_reason === 'refusal') {
    throw new AssistantError(
      stage,
      'The assistant declined to answer this one. Nothing was generated.',
    )
  }

  if (response.stop_reason === 'max_tokens') {
    // The JSON is truncated, so parsing it would fail a few lines below with a
    // worse message. This one names the actual problem.
    throw new AssistantError(stage, 'The assistant ran out of room before it finished.')
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  if (!text.trim()) throw new AssistantError(stage, 'The assistant answered with nothing.')

  try {
    return JSON.parse(text)
  } catch {
    throw new AssistantError(stage, 'The assistant answered with something that was not JSON.')
  }
}

/** The model that answered a given job, for `AssistantOrigin.model`. */
export function modelFor(job: AssistantJob): AssistantModel {
  return ASSISTANT_MODELS[job]
}
