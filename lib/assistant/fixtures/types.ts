import type { LeadStatus } from '@/lib/leads/types'
import type { TipTrigger } from '@/lib/assistant/vocabulary'
import type { BriefingObjection, BriefingPoint } from '@/lib/assistant/types'

/*
 * What a fixture is, and what it deliberately is not.
 *
 * A fixture is one CONVERSATION TYPE — not one lead. "A business with no
 * website" is a call that goes a particular way whoever is on the other end of
 * it, and the fixtures below are written as that call rather than as canned
 * answers for three invented businesses. That is why they carry placeholders
 * instead of names: a fixture that said "Bäckerei Hofmann" would only ever be
 * plausible against a lead called Bäckerei Hofmann, and the mock exists to be
 * run against the real book.
 *
 * It is data, not code, on purpose. Nothing in a fixture file may branch on its
 * input — the moment a fixture starts computing, the mock has quietly become a
 * second implementation of the thing Phase 17 is supposed to bring, and the
 * screen ends up built against behaviour that will not survive the swap.
 *
 * Placeholders are `{name}`, `{city}`, `{platform}`, `{psi}`, `{year}`,
 * `{rating}` and `{reviews}`. Every one has a fallback in the mock, so a fixture
 * may use any of them without checking whether the lead has it.
 */

/** A briefing as a fixture holds it: everything but the provenance. */
export interface FixtureBriefing {
  headline: string
  opening: string
  points: BriefingPoint[]
  objections: BriefingObjection[]
  ask: string
  avoid: string[]
}

/**
 * One tip, with the words that bring it out.
 *
 * `cues` is how a mock recognises a situation and is the one part of a fixture
 * with no counterpart in the real provider — a model will read the transcript
 * and infer. Written lowercase; the mock lowercases the transcript before
 * matching. They are substrings rather than patterns because a regex in a
 * fixture is the beginning of the branching this file forbids.
 */
export interface FixtureTip {
  trigger: TipTrigger
  cues: string[]
  body: string
}

export interface FixtureSummary {
  body: string
  suggestedStatus: LeadStatus | null
  suggestedNextAction: string | null
  /**
   * The callback, in days from the end of the call. Null when none was agreed.
   *
   * A number rather than a date because a fixture is data and data has no clock
   * — the same rule that keeps every other placeholder in here from computing
   * anything. It has to agree with `suggestedNextAction`: a fixture whose prose
   * says "call back Thursday" and whose offset says a fortnight would put two
   * different promises on the same screen.
   */
  suggestedFollowUpDays: number | null
}

export interface AssistantFixture {
  /** Stable key. Shows up in nothing the operator sees; used in tests and logs. */
  key: string
  /** The conversation type, in a phrase. */
  title: string
  /**
   * The finding codes this fixture is the answer to.
   *
   * A fixture claims a call when the diagnosis contains ANY of them. The list in
   * `index.ts` is ordered, and the first claim wins — see the note there about
   * why that ordering is a judgement rather than an implementation detail.
   *
   * Empty means the fixture claims nothing and is only ever reached as the
   * fallback.
   */
  claims: string[]
  /**
   * Whether this conversation is possible at all for the lead in hand.
   *
   *   false — only for a lead with no website. true — only for a lead that has
   *   one. null — either.
   *
   * `claims` is enough when the diagnosis is available, because a `no_website`
   * finding IS the absence of a site. The summary has no diagnosis — it is
   * handed a transcript and a lead and nothing else — so it matches on cue
   * words, and cue words are a thin enough signal to pick the wrong call: a
   * business asking where you got their number says "my data" whether or not
   * they have a website, and the summary then files a firm with a live site as
   * the one that has none.
   *
   * This is the hard fact that stops it. `AssistantLead.website` is not an
   * inference, so a conversation it rules out can be ruled out before any
   * counting starts.
   */
  requiresWebsite: boolean | null
  briefing: FixtureBriefing
  tips: FixtureTip[]
  summary: FixtureSummary
}
