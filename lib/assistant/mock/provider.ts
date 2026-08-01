import { CONSENT_TIP, LONG_CALL_TIP } from '@/lib/assistant/fixtures/ambient'
import { FALLBACK_FIXTURE, eligibleFixtures, selectFixture } from '@/lib/assistant/fixtures'
import { CONSENT_GRACE_MS, LONG_CALL_MS } from '@/lib/assistant/vocabulary'
import type { AssistantFixture, FixtureTip } from '@/lib/assistant/fixtures/types'
import type {
  Assistant,
  AssistantContext,
  AssistantLead,
  AssistantOrigin,
  Briefing,
  BriefingInput,
  BriefingObjection,
  BriefingPoint,
  BriefingProvider,
  CallSummary,
  SummaryProvider,
  Tip,
  TipContext,
  TipProvider,
  TranscriptSegment,
} from '@/lib/assistant/types'
import { AssistantError } from '@/lib/assistant/types'

/*
 * The mock. Everything the surface is built against until Phase 17.
 *
 * NOT `server-only`, and that is deliberate rather than an omission. This module
 * holds no credential, opens no socket and reads nothing but its own fixtures,
 * so the one thing `server-only` would buy is the one thing worth giving up: it
 * can be imported by a bare node session and argued with directly, which is how
 * a briefing gets read by a human before a screen is built to render it. The
 * registry in `../index.ts` is server-only, and the real provider will be too —
 * it will hold a key.
 *
 * THREE THINGS THIS MOCK DOES ON PURPOSE, and each one is a constraint on the
 * surface rather than a shortcut in the mock:
 *
 *  1. IT IS SLOW. Every answer waits 300–800ms, which is roughly what a real
 *     model costs for text this short. A mock that answered synchronously would
 *     let a call screen be built with no pending state, no stale-answer problem
 *     and no cancellation — and all three would arrive at once on the day the
 *     provider is swapped, during a live phone call.
 *
 *  2. IT IS ABORTABLE. Same reason, and the more important half: a tip
 *     requested at minute four is wrong at minute five, so the surface has to
 *     learn to throw answers away, and it can only learn that against something
 *     that can be cancelled.
 *
 *  3. IT DROPS WHAT IT CANNOT SAY. A fixture point that quotes a PageSpeed score
 *     is not rendered for a lead that has no PageSpeed score — it is removed.
 *     The alternative is a placeholder, or worse a plausible default, and the
 *     first thing this tool must never do is put a number in the operator's
 *     mouth that nothing measured. See `fill` below; it is the load-bearing
 *     function in this file.
 */

const PROVIDER_ID = 'mock'

/** Roughly what a short generation costs, so the surface is built against it. */
const MIN_DELAY_MS = 300
const MAX_DELAY_MS = 800

/** The briefing contract says three to five points. The mock enforces its half. */
const MAX_POINTS = 5

/** How far back the tip matcher reads. Roughly the last thing said. */
const TIP_WINDOW_MS = 45_000

/* ------------------------------------------------------------------------- *
 * Latency
 * ------------------------------------------------------------------------- */

function origin(): AssistantOrigin {
  return {
    provider: PROVIDER_ID,
    /*
     * Null, and it stays null. Writing 'mock-1' here would put a string that
     * looks like a model name next to `provider = 'mock'` in `call_briefings`,
     * and a year from now that row reads as a real generation with a confusing
     * label rather than as a fixture.
     */
    model: null,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Wait like a model would, and give up like one has to.
 *
 * Rejects with an `AssistantError` on abort rather than with a DOMException, so
 * that every failure a caller has to handle from this boundary is one shape.
 */
function pause(stage: AssistantError['stage'], ctx?: AssistantContext): Promise<void> {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)

  return new Promise((resolve, reject) => {
    const signal = ctx?.signal
    if (signal?.aborted) {
      reject(new AssistantError(stage, 'The assistant request was cancelled.'))
      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(new AssistantError(stage, 'The assistant request was cancelled.'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/* ------------------------------------------------------------------------- *
 * Filling a fixture in
 * ------------------------------------------------------------------------- */

/**
 * The values a fixture may reach for, and null where the lead does not have one.
 *
 * Null is what makes the strict path work: it is the difference between "this
 * business has 47 reviews" and "this business has reviews we never counted", and
 * only the first may be said out loud on a call.
 */
type Values = Record<string, string | null>

const PLACEHOLDER = /\{(\w+)\}/g

/** Values every surface can supply, because they come off the lead itself. */
function leadValues(lead: AssistantLead): Values {
  return {
    name: lead.name,
    city: lead.city,
    rating: lead.rating === null ? null : lead.rating.toFixed(1),
    reviews: lead.userRatingCount === null ? null : String(lead.userRatingCount),
  }
}

/**
 * Fill a line, or refuse to.
 *
 * Returns null when the line reaches for a value the lead does not have. The
 * caller then DROPS the line rather than papering over it — a briefing with
 * three points is a briefing; a briefing with a fourth point that says "Google
 * scores it — out of 100" is a briefing the operator stops trusting, and he is
 * reading it while a phone is ringing.
 */
function fill(template: string, values: Values): string | null {
  let missing = false

  const filled = template.replace(PLACEHOLDER, (whole, key: string) => {
    const value = values[key]
    if (value === null || value === undefined) {
      missing = true
      return whole
    }
    return value
  })

  return missing ? null : filled
}

/**
 * Fill a line that must survive, with a stand-in for what is missing.
 *
 * Used only for the headline, the opening and the ask — the three lines a
 * briefing cannot be without. Every stand-in is vague on purpose: "your area" is
 * a thing a person says when they do not know the town, which is exactly the
 * situation, and it makes no claim that can be contradicted.
 */
const STAND_INS: Values = {
  name: 'this business',
  city: 'your area',
  rating: null,
  reviews: null,
}

function fillLoose(template: string, values: Values): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    return values[key] ?? STAND_INS[key] ?? whole
  })
}

function fillPoints(points: readonly BriefingPoint[], values: Values): BriefingPoint[] {
  const kept: BriefingPoint[] = []

  for (const point of points) {
    const label = fill(point.label, values)
    const detail = fill(point.detail, values)
    if (label === null || detail === null) continue
    kept.push({ label, detail, code: point.code })
  }

  return kept.slice(0, MAX_POINTS)
}

function fillObjections(
  objections: readonly BriefingObjection[],
  values: Values,
): BriefingObjection[] {
  const kept: BriefingObjection[] = []

  for (const entry of objections) {
    const objection = fill(entry.objection, values)
    const reply = fill(entry.reply, values)
    if (objection === null || reply === null) continue
    kept.push({ objection, reply, trigger: entry.trigger })
  }

  return kept
}

/* ------------------------------------------------------------------------- *
 * 1. The briefing
 * ------------------------------------------------------------------------- */

export class MockBriefingProvider implements BriefingProvider {
  async generate(input: BriefingInput, ctx?: AssistantContext): Promise<Briefing> {
    await pause('briefing', ctx)

    const fixture = selectFixture(input.findings.map((finding) => finding.code))

    const values: Values = {
      ...leadValues(input.lead),
      platform: input.measurements.platform,
      psi:
        input.measurements.psiPerformance === null
          ? null
          : String(input.measurements.psiPerformance),
      year: input.measurements.copyrightYear === null ? null : String(input.measurements.copyrightYear),
    }

    return {
      origin: origin(),
      headline: fillLoose(fixture.briefing.headline, values),
      opening: fillLoose(fixture.briefing.opening, values),
      points: fillPoints(fixture.briefing.points, values),
      objections: fillObjections(fixture.briefing.objections, values),
      ask: fillLoose(fixture.briefing.ask, values),
      // Never filtered and never filled: the things not to say are true of the
      // conversation, not of the lead, and a lead missing a measurement is if
      // anything a lead it is easier to overclaim about.
      avoid: [...fixture.briefing.avoid],
    }
  }
}

/* ------------------------------------------------------------------------- *
 * 2. The tip
 * ------------------------------------------------------------------------- */

/** Segments in the last stretch of the call, newest first. Operator's own words excluded. */
function recentlyHeard(
  transcript: readonly TranscriptSegment[],
  atMs: number,
): TranscriptSegment[] {
  return transcript
    .filter(
      (segment) =>
        segment.speaker !== 'operator' &&
        segment.atMs <= atMs &&
        segment.atMs >= atMs - TIP_WINDOW_MS,
    )
    .sort((a, b) => b.atMs - a.atMs)
}

/**
 * Which conversation this is, recovered from the briefing already on screen.
 *
 * `TipContext` deliberately carries no diagnosis — during a call the transcript
 * is the input that matters — but the briefing carries the finding codes its
 * points were argued from, so the fixture can be recovered without widening the
 * interface for the mock's convenience. When there is no briefing, every
 * fixture's tips are in play, first match winning.
 */
function tipPool(context: TipContext): FixtureTip[] {
  if (context.briefing) {
    const codes = context.briefing.points
      .map((point) => point.code)
      .filter((code): code is string => code !== null)

    if (codes.length) return [...selectFixture(codes).tips]
  }

  const pool: FixtureTip[] = []
  const seen = new Set<string>()
  for (const fixture of eligibleFixtures(context.lead.website !== null)) {
    for (const tip of fixture.tips) {
      if (seen.has(tip.trigger)) continue
      seen.add(tip.trigger)
      pool.push(tip)
    }
  }
  return pool
}

export class MockTipProvider implements TipProvider {
  async suggest(context: TipContext, ctx?: AssistantContext): Promise<Tip | null> {
    await pause('tip', ctx)

    const shown = new Set(context.alreadyShown.map((entry) => entry.trigger))
    const values = leadValues(context.lead)

    const emit = (tip: FixtureTip): Tip | null => {
      const body = fill(tip.body, values)
      return body === null ? null : { origin: origin(), trigger: tip.trigger, body }
    }

    /*
     * Consent outranks everything, including a buying signal.
     *
     * The one tip on this screen that is not about the sale. A recording made
     * without a word said about it cannot be un-made by noticing two minutes
     * later, and the operator in the middle of a conversation is the last person
     * who will remember on his own.
     */
    if (
      !context.consentNoted &&
      context.atMs >= CONSENT_GRACE_MS &&
      !shown.has(CONSENT_TIP.trigger)
    ) {
      return emit(CONSENT_TIP)
    }

    /*
     * Then whatever was just said. Newest segment first, so the assistant reacts
     * to the last thing out of their mouth rather than to the best match in the
     * last minute — which is what a person listening would do.
     */
    const pool = tipPool(context)

    for (const segment of recentlyHeard(context.transcript, context.atMs)) {
      const heard = segment.text.toLowerCase()

      for (const tip of pool) {
        if (shown.has(tip.trigger)) continue
        if (!tip.cues.some((cue) => heard.includes(cue))) continue

        const emitted = emit(tip)
        if (emitted) return emitted
      }
    }

    // Last, and only once: the clock. Deliberately below the conversation —
    // a call that is going somewhere at minute thirteen should not be
    // interrupted to be told it is long.
    if (context.atMs >= LONG_CALL_MS && !shown.has(LONG_CALL_TIP.trigger)) {
      return emit(LONG_CALL_TIP)
    }

    // Nothing worth saying, which is the answer most of the time and is the
    // whole reason `suggest` returns a nullable.
    return null
  }
}

/* ------------------------------------------------------------------------- *
 * 3. The summary
 * ------------------------------------------------------------------------- */

/**
 * Which conversation this was, from the transcript and nothing else.
 *
 * `summarise` is handed the transcript and the lead — no diagnosis, because
 * what was found matters far less afterwards than what was said. So the mock
 * reads the words, exactly as the real provider will have to: whichever
 * fixture's cues turn up most in what the business said wins, ties go to the
 * registry order, and a call with no recognisable cue in it gets the fallback.
 *
 * Ruled out first, though. Cue counting alone is a thin signal over a short
 * call, and the first version of this function filed a business with a live
 * website under "no website at all" because the caller had asked where their
 * number came from — a cue two fixtures share. `eligibleFixtures` removes the
 * conversations the lead cannot be having before any of that starts.
 */
function fixtureFromTranscript(
  transcript: readonly TranscriptSegment[],
  lead: AssistantLead,
): AssistantFixture {
  const heard = transcript
    .filter((segment) => segment.speaker !== 'operator')
    .map((segment) => segment.text.toLowerCase())
    .join(' \n ')

  let best: AssistantFixture | null = null
  let bestHits = 0

  for (const fixture of eligibleFixtures(lead.website !== null)) {
    let hits = 0
    for (const tip of fixture.tips) {
      for (const cue of tip.cues) {
        if (heard.includes(cue)) hits += 1
      }
    }
    if (hits > bestHits) {
      best = fixture
      bestHits = hits
    }
  }

  return best ?? FALLBACK_FIXTURE
}

export class MockSummaryProvider implements SummaryProvider {
  async summarise(
    transcript: readonly TranscriptSegment[],
    lead: AssistantLead,
    ctx?: AssistantContext,
  ): Promise<CallSummary> {
    await pause('summary', ctx)

    const fixture = fixtureFromTranscript(transcript, lead)
    const values = leadValues(lead)

    return {
      origin: origin(),
      body: fillLoose(fixture.summary.body, values),
      suggestedStatus: fixture.summary.suggestedStatus,
      suggestedNextAction: fixture.summary.suggestedNextAction,
    }
  }
}

/* ------------------------------------------------------------------------- *
 * The three of them
 * ------------------------------------------------------------------------- */

export const MOCK_ASSISTANT: Assistant = {
  id: PROVIDER_ID,
  label: 'Mock (fixtures)',
  briefing: new MockBriefingProvider(),
  tip: new MockTipProvider(),
  summary: new MockSummaryProvider(),
}
