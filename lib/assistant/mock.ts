import {
  AVOID_IF_PASSED,
  EVIDENCE_LINES,
  HOOK_LINES,
  OBJECTIONS,
  factsOf,
  firstSentence,
} from '@/lib/assistant/fixtures/phrasing'
import type {
  Briefing,
  BriefingEvidence,
  BriefingFinding,
  BriefingHook,
  BriefingInput,
  BriefingObjection,
  BriefingProvider,
  BriefingResult,
} from '@/lib/assistant/types'

/*
 * The briefing provider that exists today: no model, no network, no cost.
 *
 * It is not a placeholder that returns lorem ipsum. Every sentence it produces
 * is one the operator can say, chosen by rules he can read, and the product is
 * usable on the strength of it alone — which is the point of the mock rule
 * rather than an accident of it. `monthly_ceiling_usd` is 0; a feature that only
 * works once somebody wires up a paid model is a feature that does not work.
 *
 * What a real provider will do better is judgement: which two faults to lead
 * with for a Zahnarzt as against a Dachdecker, how to say the third one when the
 * second has already landed, when to drop the pitch entirely. What it will not
 * do better is the arithmetic — the ordering below comes from the scorer, and a
 * model that re-ranked by instinct would be discarding measured evidence for a
 * hunch. So `strength` is on the interface, and any provider that reorders these
 * has to say what it reordered them by.
 *
 * Determinism is deliberate and worth keeping: the same input produces the same
 * briefing, so a briefing stored in June can be reproduced in August from the
 * `input` column beside it and the two compared. That is the property that makes
 * a model's output arguable when one arrives.
 */

/**
 * The one slot the app cannot fill.
 *
 * Lead Engine knows the operator's email address and nothing else about him —
 * no name, no company, no line about what he sells. Inventing one would put
 * words in his mouth in the single sentence he is most likely to read verbatim,
 * so the briefing leaves a bracket and he says his own name.
 */
const SPEAKER = '[your name]'

/** Hooks on the sheet. Five is a glance; ten is a document. */
const MAX_HOOKS = 5
/** Figures worth reading before dialling. */
const MAX_EVIDENCE = 6
/** Three objections, as asked for: the ones that end a call if fumbled. */
const MAX_OBJECTIONS = 3
const MAX_AVOID = 5

/** A rating an owner is proud of, and will defend if the pitch sounds like criticism. */
const PROUD_RATING = 4.5
/** Below this a rating is a number, not a reputation. */
const PROUD_REVIEWS = 15

function strengthOf(finding: BriefingFinding): number {
  return finding.contribution ?? finding.weight ?? 0
}

/** "14 June" — a date to say, not a date to read off a row. */
function spokenDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/* ------------------------------------------------------------------------- *
 * Opener
 * ------------------------------------------------------------------------- */

/**
 * Two or three sentences, and one of them asks permission.
 *
 * The consent sentence is not decoration. A cold B2B call in Germany stands on
 * §7 UWG's presumed-interest test, and the practical form of that is saying who
 * is calling and why in the first breath, then asking whether now is the moment.
 * It is also, separately, what stops the call being hung up in four seconds.
 *
 * The third sentence is the hinge: the single strongest finding, said as a
 * reason for the call rather than as a complaint. A lead with nothing wrong with
 * it gets two sentences and an honest one at that — see the branch at the end.
 */
function buildOpener(input: BriefingInput, hooks: BriefingHook[]): string[] {
  const { business, history } = input
  const where = business.city ? ` in ${business.city}` : ''
  const trade = business.category ? business.category.toLowerCase() : 'local'

  const lines: string[] = []

  if (history.attempts > 0 && history.lastContactAt) {
    lines.push(
      `Good morning — ${SPEAKER} again, about ${business.name}${where}. We spoke on ${spokenDate(history.lastContactAt)}.`,
    )
    lines.push(
      'I said I would come back to you, and I have got something specific this time rather than the same call — have you got two minutes?',
    )
  } else {
    lines.push(`Good morning — is that ${business.name}${where}?`)
    lines.push(
      `My name is ${SPEAKER}; I look after websites for ${trade} businesses around here. I checked yours before ringing rather than after, and I am not selling down the phone — have you got two minutes, or shall I call back?`,
    )
  }

  const hinge = hooks[0]
  if (hinge) {
    // The hook is spliced in with its capital intact. Lowercasing it to read as
    // one sentence was the obvious thing and it is wrong: half these lines open
    // on a proper noun, and "chrome puts Not secure in the address bar" is a
    // sentence the operator would have to correct mid-breath.
    lines.push(`The reason I am calling: ${hinge.text}`)
  } else {
    // Nothing failed. Said plainly rather than dressed up — the operator is
    // better served by knowing there is no opening than by being handed one.
    lines.push(
      'There is nothing wrong with your web presence that I can find, so this is a short call: I am asking what you would want it to do that it does not.',
    )
  }

  return lines
}

/* ------------------------------------------------------------------------- *
 * Hooks
 * ------------------------------------------------------------------------- */

function hookText(finding: BriefingFinding): string {
  const line = HOOK_LINES[finding.code]
  // A code with no line yet falls back to the audit's own words rather than
  // vanishing. It reads as third-person notes rather than as speech, which is
  // visible and fixable — one entry in the fixtures — and infinitely better
  // than a new check being silently unbriefable.
  return line ? line(finding) : firstSentence(finding.message)
}

/**
 * Three to five reasons to keep listening, strongest first.
 *
 * Compliance and technical faults are merged here, having been kept apart in the
 * input. That is not a contradiction: they are separated so the provider can
 * SEE which is which and say them differently, and merged so the strongest
 * thing leads regardless of which list it came from. A missing Impressum
 * outranks a missing favicon on any lead, and a hook list that put every legal
 * finding after every technical one would bury it.
 */
function buildHooks(input: BriefingInput): BriefingHook[] {
  const hooks: BriefingHook[] = [...input.faults, ...input.compliance]
    .sort((a, b) => strengthOf(b) - strengthOf(a))
    .slice(0, MAX_HOOKS)
    .map((finding) => ({
      text: hookText(finding),
      code: finding.code,
      strength: strengthOf(finding),
    }))

  /*
   * The turn from fault to opportunity, and it is not a fault, so it does not
   * compete with the list above and carries no strength.
   *
   * It goes last on purpose. It is the sentence he reaches for once the faults
   * have landed and the owner has stopped defending — sorted into the middle by
   * some invented weight, it would be the thing he opens with, which turns a
   * diagnosis into a compliment.
   *
   * And it is only true for a business with nowhere to send anybody. Said to an
   * owner who does have a site, "nowhere to send the people who read them" is
   * exactly the kind of claim that can be disproved in one sentence, which is
   * the failure the `avoid` list exists to prevent — so the condition is the
   * absence of a site of their own, not merely a good rating.
   */
  const { rating, reviewCount } = input.business
  const homeless =
    input.faults.some((finding) => finding.code === 'no_website' || finding.code === 'social_only')

  if (
    homeless &&
    hooks.length < MAX_HOOKS &&
    rating !== null &&
    rating >= PROUD_RATING &&
    (reviewCount ?? 0) >= PROUD_REVIEWS
  ) {
    hooks.push({
      text: `You have ${reviewCount} reviews at ${rating} stars and nowhere to send the people who read them.`,
      code: null,
      strength: 0,
    })
  }

  return hooks
}

/* ------------------------------------------------------------------------- *
 * Evidence
 * ------------------------------------------------------------------------- */

/**
 * The figures, in the order the faults are said in.
 *
 * Their own rating leads when they have one worth hearing: it is the only number
 * on the sheet the owner already knows, and saying it first is what makes the
 * rest of them sound like observations rather than accusations.
 */
function buildEvidence(input: BriefingInput): BriefingEvidence[] {
  const lines: BriefingEvidence[] = []
  const { rating, reviewCount } = input.business

  if (rating !== null && reviewCount) {
    lines.push({
      label: 'Their Google rating',
      value: `${rating} from ${reviewCount} reviews`,
      code: null,
    })
  }

  for (const finding of [...input.faults, ...input.compliance].sort(
    (a, b) => strengthOf(b) - strengthOf(a),
  )) {
    if (lines.length >= MAX_EVIDENCE) break
    const line = EVIDENCE_LINES[finding.code]?.(finding)
    if (line) lines.push({ ...line, code: finding.code })
  }

  return lines
}

/* ------------------------------------------------------------------------- *
 * Objections
 * ------------------------------------------------------------------------- */

function buildObjections(input: BriefingInput): BriefingObjection[] {
  const facts = factsOf(input)

  return OBJECTIONS.filter((fixture) => fixture.applies(facts))
    .sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key))
    .slice(0, MAX_OBJECTIONS)
    .map((fixture) => ({ objection: fixture.objection, answer: fixture.answer(facts) }))
}

/* ------------------------------------------------------------------------- *
 * Avoid
 * ------------------------------------------------------------------------- */

/**
 * What will not land on this lead.
 *
 * Passing checks first, because they are the ones that end a call: an owner who
 * has just been told their site is not secure, and can see the padlock, has
 * learned that the caller did not look. Everything after that is about tone.
 */
function buildAvoid(input: BriefingInput): string[] {
  const facts = factsOf(input)
  const avoid: string[] = []

  /*
   * Walked in the fixtures' own order rather than in the audit's. The audit
   * emits findings in the order it measured them, which is a fact about the
   * checker; what belongs at the top of this list is the claim that ends a call
   * fastest, which is a judgement, and it is written down as the order of
   * `AVOID_IF_PASSED`.
   */
  for (const [code, line] of Object.entries(AVOID_IF_PASSED)) {
    if (!facts.passed.has(code)) continue
    avoid.push(line)
    if (avoid.length >= 3) break
  }

  if (!facts.firstContact && input.history.lastContactAt) {
    avoid.push(
      `Don’t open as though this were the first call — you last reached them on ${spokenDate(input.history.lastContactAt)}.`,
    )
  }

  const { rating, reviewCount } = input.business
  if (rating !== null && rating >= PROUD_RATING && (reviewCount ?? 0) >= PROUD_REVIEWS) {
    avoid.push(
      `Don’t imply the business is doing badly. ${rating} stars from ${reviewCount} reviews is the number they are proudest of — the gap is what people can’t find, not how they work.`,
    )
  }

  if (input.reviewsFetched && input.reviews.length === 0) {
    avoid.push('Don’t reach for their reviews. Google shows none for this business.')
  }

  /*
   * PageSpeed is a stage that can simply not have run — no site to test, a rate
   * limit, a key that was never set. `psi_weak` is the code the audit writes on
   * a PASSING performance run (see `judgePerformance`), so its presence on
   * either side is what proves a number exists at all.
   */
  const SPEED_CODES = ['psi_poor', 'psi_weak', 'poor_lcp', 'layout_shift']
  const measuredSpeed = SPEED_CODES.some(
    (code) => facts.failed.has(code) || facts.passed.has(code),
  )
  if (!measuredSpeed) {
    avoid.push('Don’t quote a speed figure. PageSpeed never scored this site, so there isn’t one.')
  }

  if (input.faults.length === 0 && input.compliance.length > 0) {
    avoid.push(
      'Don’t let the call become about the Impressum. The legal gap opens the door; it is twenty minutes of work and no reason to rebuild anything.',
    )
  }

  return avoid.slice(0, MAX_AVOID)
}

/* ------------------------------------------------------------------------- *
 * The provider
 * ------------------------------------------------------------------------- */

export class MockBriefingProvider implements BriefingProvider {
  readonly id = 'mock'
  readonly label = 'Fixture assistant'
  readonly model = null

  async prepare(input: BriefingInput): Promise<BriefingResult> {
    const hooks = buildHooks(input)

    const briefing: Briefing = {
      opener: buildOpener(input, hooks),
      hooks,
      evidence: buildEvidence(input),
      objections: buildObjections(input),
      avoid: buildAvoid(input),
    }

    // No request was made, so nothing is billed. The empty array is the honest
    // answer rather than an omission — see `BriefingResult.cost`.
    return { briefing, cost: [] }
  }
}
