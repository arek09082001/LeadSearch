import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { ASSISTANT_MODELS, type AssistantJob, type AssistantModel } from '@/lib/assistant/anthropic/pricing'
import { AssistantSpendGuard, estimateInputTokens } from '@/lib/assistant/anthropic/spend'
import { AssistantError } from '@/lib/assistant/types'
import type { Deadline } from '@/lib/deadline'
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
         * NOTHING IS DECIDED HERE ANY MORE, and that is the fix rather than a
         * tidy-up. A client-wide 25-second timeout with one retry is a request
         * that may take fifty seconds, which was longer than the route that made
         * it was allowed to live — so a briefing that timed out once did not fail,
         * it went round again and took the whole function down with it, and the
         * operator read a parse error. Both numbers now come from `attemptFor`,
         * per request, out of what is actually left of his minute.
         *
         * These two are the floor for a caller that handed over no deadline at
         * all: a node session, a script. Zero retries because the fallback for a
         * caller who did not say how long he could wait should be to fail once
         * and say so.
         */
        maxRetries: 0,
        timeout: 60_000,
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
 * because the route gives them a minute and a briefing that arrives after the
 * call has started is not a briefing. Medium is what fits in that minute with
 * room for a second attempt; see `MAX_ATTEMPT_MS`.
 */
function thinkingFor(job: AssistantJob) {
  return job === 'tip'
    ? ({ type: 'disabled' } as const)
    : ({ type: 'adaptive' } as const)
}

/* ------------------------------------------------------------------------- *
 * Time
 * ------------------------------------------------------------------------- */

/**
 * The longest one attempt is ever given, per job.
 *
 * A ceiling on the attempt rather than the answer: what actually bounds the wait
 * is the caller's deadline, and these exist so that a job with room for two
 * chances spends it on two rather than on one very patient one. Ten seconds is
 * already several times what Haiku needs with thinking off, and the point of the
 * number is the other end of it: a stalled tip is abandoned and retried while the
 * sentence it was about is still being spoken.
 */
const MAX_ATTEMPT_MS: Record<AssistantJob, number> = {
  tip: 10_000,
  briefing: 45_000,
  summary: 45_000,
}

/**
 * What is left over for the work either side of the request.
 *
 * The ledger row is written after the answer arrives and the caller still has a
 * row of its own to write — `call_briefings`, `call_summaries` — before anything
 * reaches the screen. An attempt allowed to run to the last millisecond of the
 * deadline would be an attempt that succeeded into a request that had already
 * run out of time to say so.
 */
const RESERVE_MS = 3_000

/**
 * Below this there is no point sending anything.
 *
 * A request opened with four seconds left is billed in full and read by nobody,
 * because the deadline cuts it off mid-generation. Refusing early costs the
 * operator the same briefing and not the money, and it gives him a sentence
 * naming what happened rather than a spinner that ends in a gateway page.
 */
const MIN_ATTEMPT_MS = 5_000

/**
 * The end of every sentence about time.
 *
 * Said because it is the only thing the operator can do about it, and because a
 * timeout leaves no row: unlike a refusal, which is an answer, this is a request
 * that did not happen and pressing again is a reasonable response to it.
 */
const WAITED = 'Nothing was written. Try again.'

/**
 * How long this attempt gets, and whether a second one fits inside the deadline.
 *
 * THE RETRY IS CONDITIONAL AND THAT IS THE POINT. A retry is worth having — a
 * 429 or a 500 on the first try is ordinary and a second attempt usually works —
 * but only when there is room for it. A retry that cannot finish before the
 * caller stops waiting does not rescue the request, it guarantees the request
 * dies at the platform's hand instead of this one's.
 */
function attemptFor(
  job: AssistantJob,
  stage: AssistantError['stage'],
  deadline: Deadline | undefined,
): { timeout: number; maxRetries: number } {
  const ceiling = MAX_ATTEMPT_MS[job]
  if (!deadline) return { timeout: ceiling, maxRetries: 1 }

  const remaining = deadline.remainingMs() - RESERVE_MS
  if (remaining < MIN_ATTEMPT_MS) {
    throw new AssistantError(
      stage,
      'There was not enough time left to ask the assistant. Nothing was sent. Try again.',
    )
  }

  const timeout = Math.min(remaining, ceiling)
  return { timeout, maxRetries: remaining >= timeout * 2 ? 1 : 0 }
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
  /** What is left of the caller's patience. See `attemptFor`. */
  deadline?: Deadline
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
  deadline,
}: Ask): Promise<unknown> {
  const model: AssistantModel = ASSISTANT_MODELS[job]
  const maxTokens = MAX_TOKENS[job]

  // Before the ledger is read, because reading it is itself two round trips and
  // there is no sense spending them on a request there is no time to make.
  const attempt = attemptFor(job, stage, deadline)

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
      { signal, timeout: attempt.timeout, maxRetries: attempt.maxRetries },
    )
  } catch (error) {
    /*
     * Out of time is not "could not be reached", and the operator is owed the
     * difference: one of them means try again, the other means something is
     * wrong. Checked before the SDK's own classes because an abort arrives as an
     * `APIUserAbortError` and a timeout as an `APIConnectionTimeoutError`, and
     * both of those would otherwise be reported as a network that failed.
     */
    if (deadline?.expired) {
      throw new AssistantError(stage, `The assistant did not answer in time. ${WAITED}`)
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new AssistantError(
        stage,
        `The assistant did not answer within ${Math.round(attempt.timeout / 1000)} seconds. ${WAITED}`,
      )
    }
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
