import {
  FINDING_CODES,
  FINDING_SPECS,
  isFindingCode,
  type FindingSeverity,
} from '@/lib/enrichment/vocabulary'
import type { LeadStatus } from '@/lib/leads/types'
import { SCORING_CONFIG } from '@/lib/scoring/config'

/*
 * What the diagnosis was worth, measured against what happened on the phone.
 *
 * Every number in `lib/scoring/config.ts` is an opinion. They were argued into
 * place with care, and not one of them has ever been checked against an outcome:
 * `lead_scores.factors` has recorded which faults a lead was ranked on since the
 * first score was written, `leads.status` has recorded how the call went, and
 * the two have never been put side by side. This module puts them side by side.
 *
 * Pure — no database, no clock — for the reason `score.ts` is pure. The
 * arithmetic here is the argument, so it has to be readable, re-runnable and
 * arguable on its own; `store.ts` is the half that knows column names.
 *
 * FOUR RULES, and every one of them is a decision about honesty rather than
 * about arithmetic:
 *
 *   1. Only worked leads count. A lead sitting on `new` says nothing about the
 *      weights — only that it has not been rung — and counting it as a lead that
 *      failed to close would make every code look worse the more leads are
 *      saved.
 *   2. The rate is won over DECIDED, not over contacted. A lead still in flight
 *      is not a loss yet, and putting it in the denominator would make an
 *      actively-worked code look worse than an abandoned one.
 *   3. A rate computed from too few decided leads is shown WITH the fact that it
 *      means nothing. Not hidden — the count is real and worth seeing — but
 *      never ranked, and never drawn as a bar. Three closes out of four is
 *      noise, and a surface that draws it as three quarters of a bar is a
 *      surface that talks the operator into re-tuning weights that were right.
 *   4. One lead carries several faults, so it is counted in every code row its
 *      diagnosis contained. The rates below therefore do not partition anything
 *      and cannot be added up. What a code's rate says is "leads carrying this
 *      fault closed at X" — never "this fault closed X of them".
 *
 * And one rule about what this file must never grow into: NOTHING HERE WRITES A
 * WEIGHT. This module reports; the decision stays a line in `config.ts` that the
 * operator types himself, under a bumped `version`, followed by a rescore. A
 * page that quietly re-tuned the ranking from forty phone calls would be a page
 * that had stopped being evidence and started being an opinion with a database.
 */

/**
 * The statuses a lead can only be in because somebody actually reached out.
 *
 * `researching` is not here: it is work done on the lead, not to the business.
 * `parked` is not here either, and that one is worth stating — a lead can be
 * parked before it was ever called, so its presence says nothing on its own. A
 * lead that WAS called and later parked is still counted, because the outreach
 * log remembers the transition even after the status has moved on. See
 * `store.ts`, which reads that history rather than only the current status.
 */
export const WORKED_STATUSES = [
  'contacted',
  'replied',
  'proposal',
  'won',
  'lost',
] as const satisfies readonly LeadStatus[]

export function isWorkedStatus(status: LeadStatus): boolean {
  return (WORKED_STATUSES as readonly string[]).includes(status)
}

/**
 * How a worked lead ended, in the only three states that matter here.
 *
 * `parked` and a lead moved back to `new` land in `open` rather than in `lost`.
 * Setting a lead aside is not a rejection, and filing every deferral as a
 * failure would push every code's rate down by however much the operator's
 * queue discipline slipped that month.
 */
export type Outcome = 'won' | 'lost' | 'open'

export function outcomeOf(status: LeadStatus): Outcome {
  if (status === 'won') return 'won'
  if (status === 'lost') return 'lost'
  return 'open'
}

/**
 * How many decided leads a rate needs before it is worth reading.
 *
 * The operator's own number, and it is a convention rather than a law: thirty is
 * where the swing of a single extra close stops rewriting the answer. At four
 * decided leads one more win moves the rate twenty points; at thirty it moves it
 * three. Below this line the page shows the count and says out loud that the
 * percentage beside it means nothing, and refuses to rank on it.
 *
 * It is deliberately the same floor for a finding code and for a score band. Two
 * different thresholds would be two different standards of proof on one screen.
 */
export const SAMPLE_FLOOR = 30

/* ------------------------------------------------------------------------- *
 * The bands
 * ------------------------------------------------------------------------- */

/** Where a lead that had no score when it was called is counted. */
export const UNSCORED_BAND = 'unscored'

export interface ScoreBand {
  key: string
  label: string
  min: number
  max: number
}

/**
 * Decades, high first — the shape of the question actually being asked.
 *
 * "Do 90s really close better than 60s" is a question about tens, so tens is
 * what the page answers in. Finer bands would each hold too few leads to read;
 * coarser ones would fold the top of the book into the middle of it, which is
 * the one distinction the operator is asking about.
 *
 * The top band is eleven wide because a score of 100 has to live somewhere, and
 * a band of its own holding a handful of leads would say less than nothing.
 */
export const SCORE_BANDS: readonly ScoreBand[] = Array.from({ length: 10 }, (_, index) => {
  const min = 90 - index * 10
  const max = min === 90 ? 100 : min + 9
  return { key: String(min), label: `${min}–${max}`, min, max }
})

export function bandOf(score: number | null): string {
  if (score === null) return UNSCORED_BAND
  return String(Math.min(90, Math.max(0, Math.floor(score / 10) * 10)))
}

/* ------------------------------------------------------------------------- *
 * The input
 * ------------------------------------------------------------------------- */

/**
 * One lead that was actually worked, as this analysis reads it.
 *
 * `score` and `codes` are the ones the lead carried WHEN IT WAS CALLED, not the
 * ones on it today — see `store.ts`. That distinction is the difference between
 * measuring the diagnosis and measuring an accident: a lead called in January
 * because it had no website, which built one in March, would otherwise be filed
 * under whatever its rebuilt site scores now, and its close would be credited to
 * a diagnosis that was never pitched.
 */
export interface WorkedLead {
  id: string
  outcome: Outcome
  /** 0–100, or null when the lead had no score, or one deliberately withheld. */
  score: number | null
  /**
   * The failed finding codes the score was computed from.
   *
   * Null means the breakdown could not be read at all — no score row, or one
   * written under an older shape. Distinct from an empty array, which is a real
   * diagnosis that found nothing wrong and is a fact about the lead.
   */
  codes: string[] | null
  /** The config version that produced `score`. Null when there was no score. */
  configVersion: string | null
  /** True when the lead has been scored again since the call. */
  rescoredSince: boolean
}

/* ------------------------------------------------------------------------- *
 * The output
 * ------------------------------------------------------------------------- */

export interface Tally {
  /** Leads counted in this row. */
  worked: number
  /** Still in flight: contacted, replied, or a proposal out. Not a loss yet. */
  open: number
  won: number
  lost: number
  /** won + lost. The denominator of `rate`, and what `reliable` is measured on. */
  decided: number
  /**
   * won ÷ decided, 0–1. Null when nothing has been decided.
   *
   * Never 0 for "no data": zero means every decided lead here was lost, which is
   * a finding, and conflating it with an empty row would be the same lie the
   * scorer avoids by withholding a score rather than writing one.
   */
  rate: number | null
  /** decided >= SAMPLE_FLOOR. False means `rate` is a number, not evidence. */
  reliable: boolean
}

export interface CodeOutcome extends Tally {
  code: string
  mark: string
  label: string
  severity: FindingSeverity
  /**
   * What `config.ts` pays for this fault today.
   *
   * Carried so the two columns can be read against each other — a code worth 45
   * points that never closes is the entire reason this page exists. Null for a
   * code that is no longer in the vocabulary, which is not the same as 0.
   */
  weight: number | null
}

export interface BandOutcome extends Tally {
  key: string
  label: string
}

export interface OutcomeReport {
  /** Every worked lead, as one row. The sample the rest of the page sits on. */
  overall: Tally
  /** Ranked: readable rates first, best first; the rest below by evidence. */
  codes: CodeOutcome[]
  /** Decades, high first, occupied bands only. `unscored` last when present. */
  bands: BandOutcome[]
  /** Vocabulary codes no worked lead has ever carried. Absence of evidence. */
  unseen: { code: string; mark: string }[]
  /** Distinct config versions in the sample. More than one means mixed scales. */
  configVersions: string[]
  /** Worked leads scored again since the call — a re-audit or a weight change. */
  rescoredSince: number
  /** Worked leads whose diagnosis could not be read. In the bands, in no code. */
  withoutDiagnosis: number
  /** Restated on the report so the surface renders one number, not two. */
  floor: number
}

interface Counts {
  worked: number
  open: number
  won: number
  lost: number
}

function blank(): Counts {
  return { worked: 0, open: 0, won: 0, lost: 0 }
}

function add(counts: Counts, outcome: Outcome): void {
  counts.worked += 1
  counts[outcome] += 1
}

function tally(counts: Counts): Tally {
  const decided = counts.won + counts.lost
  return {
    ...counts,
    decided,
    rate: decided === 0 ? null : counts.won / decided,
    reliable: decided >= SAMPLE_FLOOR,
  }
}

/**
 * The whole report, from the worked leads and nothing else.
 *
 * Deliberately takes a plain array: the same function answers "what does my book
 * say" in the page and "what would it have said last month" in a script, and
 * neither has to own a database connection to do it.
 */
export function summariseOutcomes(leads: readonly WorkedLead[]): OutcomeReport {
  const overall = blank()
  const byCode = new Map<string, Counts>()
  const byBand = new Map<string, Counts>()
  const versions = new Set<string>()

  let rescoredSince = 0
  let withoutDiagnosis = 0

  for (const lead of leads) {
    add(overall, lead.outcome)

    if (lead.rescoredSince) rescoredSince += 1
    if (lead.configVersion) versions.add(lead.configVersion)

    const band = bandOf(lead.score)
    const bandCounts = byBand.get(band) ?? blank()
    add(bandCounts, lead.outcome)
    byBand.set(band, bandCounts)

    if (lead.codes === null) {
      withoutDiagnosis += 1
      continue
    }

    // Deduplicated per lead: a breakdown holds one row per fault already, but a
    // lead counted twice for one code would inflate exactly the rows the page is
    // read for, and the cost of being sure is a Set.
    for (const code of new Set(lead.codes)) {
      const counts = byCode.get(code) ?? blank()
      add(counts, lead.outcome)
      byCode.set(code, counts)
    }
  }

  const codes: CodeOutcome[] = [...byCode.entries()].map(([code, counts]) => {
    const known = isFindingCode(code)
    const spec = known ? FINDING_SPECS[code] : null
    return {
      code,
      // A code the running vocabulary no longer knows is shown under its own
      // name rather than dropped. It was scored once, it was pitched once, and
      // hiding it would quietly shrink the sample with nothing saying so.
      mark: spec?.mark ?? code,
      label: spec?.label ?? code,
      severity: spec?.severity ?? 'info',
      weight: known ? SCORING_CONFIG.points[code] : null,
      ...tally(counts),
    }
  })

  codes.sort(rankCodes)

  const bands: BandOutcome[] = SCORE_BANDS.filter((band) => byBand.has(band.key)).map((band) => ({
    key: band.key,
    label: band.label,
    ...tally(byBand.get(band.key)!),
  }))

  const unscored = byBand.get(UNSCORED_BAND)
  if (unscored) {
    // Last, and outside the ordering: these leads were called without a number
    // on them, so they are not a rung of the ladder the bands above describe.
    bands.push({ key: UNSCORED_BAND, label: 'No score', ...tally(unscored) })
  }

  return {
    overall: tally(overall),
    codes,
    bands,
    unseen: FINDING_CODES.filter((code) => !byCode.has(code)).map((code) => ({
      code,
      mark: FINDING_SPECS[code].mark,
    })),
    configVersions: [...versions].sort(),
    rescoredSince,
    withoutDiagnosis,
    floor: SAMPLE_FLOOR,
  }
}

/**
 * The order the codes are read in, and it is an argument rather than a default.
 *
 * Readable rows first, best closer at the top — that is the answer to the
 * question the page was built for. Everything under the floor is sorted by how
 * much evidence it has instead, because among rows that cannot be ranked on
 * their rate the useful ordering is "closest to being worth reading".
 *
 * Sorting the whole table by rate would put a code that closed its only decided
 * lead above one that closed forty of a hundred, and that single line of sorting
 * would undo everything else this module does.
 */
function rankCodes(a: CodeOutcome, b: CodeOutcome): number {
  if (a.reliable !== b.reliable) return a.reliable ? -1 : 1
  if (a.reliable && b.reliable && a.rate !== b.rate) return (b.rate ?? 0) - (a.rate ?? 0)
  if (a.decided !== b.decided) return b.decided - a.decided
  if (a.worked !== b.worked) return b.worked - a.worked
  return a.code.localeCompare(b.code)
}
