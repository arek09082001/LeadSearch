import 'server-only'

import { ask, modelFor } from '@/lib/assistant/anthropic/client'
import type { AssistantJob } from '@/lib/assistant/anthropic/pricing'
import {
  BRIEFING_SYSTEM,
  SUMMARY_SYSTEM,
  TIP_SYSTEM,
  briefingPrompt,
  summaryPrompt,
  tipPrompt,
} from '@/lib/assistant/anthropic/prompts'
import {
  SUMMARY_SCHEMA,
  TIP_SCHEMA,
  briefingSchema,
  readBriefing,
  readSummary,
  readTip,
} from '@/lib/assistant/anthropic/shapes'
import type {
  Assistant,
  AssistantContext,
  AssistantLead,
  AssistantOrigin,
  Briefing,
  BriefingInput,
  BriefingProvider,
  CallSummary,
  SummaryProvider,
  Tip,
  TipContext,
  TipProvider,
  TranscriptSegment,
} from '@/lib/assistant/types'

/*
 * The model-backed assistant. Three jobs, three models, one boundary.
 *
 * SHORT ON PURPOSE, and that is the argument for the shape of this folder. Every
 * decision that could be got wrong lives somewhere it can be argued with on its
 * own: what it costs in `pricing.ts`, what it is allowed to cost in `spend.ts`,
 * what it is allowed to say in `prompts.ts`, what it is allowed to return in
 * `shapes.ts`. What is left here is the wiring, and wiring should be boring.
 *
 * IT SATISFIES THE SAME INTERFACES THE MOCK DOES AND NOTHING ABOVE THE BOUNDARY
 * CHANGES. `types.ts` says the mock is not a placeholder but the arrangement the
 * surface was built against — slow, abortable, allowed to say nothing — and
 * every one of those properties is true of this too, for real reasons now
 * instead of simulated ones. The mock stays, and it is the test environment.
 */

const PROVIDER_ID = 'anthropic'

/**
 * Who answered, stamped here rather than read from the answer.
 *
 * `AssistantOrigin.model` is filled with a real model name, which is exactly
 * what the mock is forbidden to do — the pair of decisions is the point. A row
 * in `call_briefings` says `anthropic` and names the model beside it, and it
 * reads a year from now as what it is.
 */
function origin(job: AssistantJob): AssistantOrigin {
  return {
    provider: PROVIDER_ID,
    model: modelFor(job),
    generatedAt: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------------- *
 * 1. The briefing
 * ------------------------------------------------------------------------- */

export class AnthropicBriefingProvider implements BriefingProvider {
  async generate(input: BriefingInput, ctx?: AssistantContext): Promise<Briefing> {
    const answer = await ask({
      job: 'briefing',
      stage: 'briefing',
      system: BRIEFING_SYSTEM,
      prompt: briefingPrompt(input),
      /*
       * The schema is built from this lead's findings, so a point cannot cite a
       * fault the audit did not find. The mock achieves the same thing by
       * dropping any line that reaches for a value the lead does not have; this
       * achieves it one step earlier, by making the wrong answer unspeakable.
       */
      schema: briefingSchema(input.findings.map((finding) => finding.code)),
      callId: ctx?.callId ?? null,
      signal: ctx?.signal,
    })

    return readBriefing(answer, origin('briefing'))
  }
}

/* ------------------------------------------------------------------------- *
 * 2. The tip
 * ------------------------------------------------------------------------- */

export class AnthropicTipProvider implements TipProvider {
  async suggest(context: TipContext, ctx?: AssistantContext): Promise<Tip | null> {
    const answer = await ask({
      job: 'tip',
      stage: 'tip',
      system: TIP_SYSTEM,
      prompt: tipPrompt(context),
      schema: TIP_SCHEMA,
      // The one job that always knows which call it belongs to.
      callId: ctx?.callId ?? context.callId,
      signal: ctx?.signal,
    })

    // Null travels back as null. It is the ordinary answer and the surface
    // already knows what to do with it — `manualTip`, with no second round trip.
    return readTip(answer, origin('tip'))
  }
}

/* ------------------------------------------------------------------------- *
 * 3. The summary
 * ------------------------------------------------------------------------- */

export class AnthropicSummaryProvider implements SummaryProvider {
  async summarise(
    transcript: readonly TranscriptSegment[],
    lead: AssistantLead,
    ctx?: AssistantContext,
  ): Promise<CallSummary> {
    const answer = await ask({
      job: 'summary',
      stage: 'summary',
      system: SUMMARY_SYSTEM,
      prompt: summaryPrompt(transcript, lead),
      schema: SUMMARY_SCHEMA,
      callId: ctx?.callId ?? null,
      signal: ctx?.signal,
    })

    return readSummary(answer, origin('summary'))
  }
}

/* ------------------------------------------------------------------------- *
 * The three of them
 * ------------------------------------------------------------------------- */

export const ANTHROPIC_ASSISTANT: Assistant = {
  id: PROVIDER_ID,
  label: 'Anthropic (Sonnet 5 / Haiku 4.5)',
  briefing: new AnthropicBriefingProvider(),
  tip: new AnthropicTipProvider(),
  summary: new AnthropicSummaryProvider(),
}
