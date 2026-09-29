import 'server-only'

import { SCORING_CONFIG } from '@/lib/scoring/config'
import { scoreLead } from '@/lib/scoring/score'
import {
  readAllScoringInputs,
  readFindingsByAudit,
  readScoreQueue,
  writeScores,
  type ScoringInput,
  type ScoreWrite,
} from '@/lib/scoring/store'

/*
 * Scoring, as a pass.
 *
 * There is no network in this file and there is none underneath it. Everything
 * it reads was written by the enrichment pipeline and is sitting in Postgres:
 * the findings, the rating, the review count. That is the entire payoff of
 * keeping `findings.ts` pure and storing its judgements as rows — changing a
 * weight and re-ranking five hundred leads is three queries and some
 * arithmetic, not five hundred websites fetched again to answer a question none
 * of them were ever asked.
 *
 * Two entry points, because there are two different reasons to score:
 *
 *   runScoring()  — leads whose newest audit has settled without a score. The
 *                   ordinary path, run after the audit pass on the same request.
 *   rescoreBook() — every live lead, unconditionally. What `config.ts` changing
 *                   means. Deliberate, operator-triggered, and the reason the
 *                   arithmetic was kept free.
 */

export interface ScoringPass {
  /** Leads that got a new score row. */
  scored: number
  /** Leads the arithmetic reached and left exactly as they were. */
  unchanged: number
  /** Of those scored, how many were deliberately taken out of the ranking. */
  excluded: number
}

const EMPTY: ScoringPass = { scored: 0, unchanged: 0, excluded: 0 }

/**
 * Score a set of leads that has already been read.
 *
 * `skipUnchanged` is what makes an afternoon of tuning bearable. A rescore that
 * moved nothing should leave nothing behind: `lead_scores` is append-only
 * history, and five hundred identical rows per experiment would bury the entries
 * that record a real change of mind. A lead is left alone only when the config
 * version AND the resulting score both match what is already on it — so the
 * first score, a version bump and any actual movement all still get written.
 */
async function scoreInputs(inputs: ScoringInput[], skipUnchanged: boolean): Promise<ScoringPass> {
  if (!inputs.length) return { ...EMPTY }

  const findingsByAudit = await readFindingsByAudit(inputs.map((input) => input.auditId))

  const writes: ScoreWrite[] = []
  let unchanged = 0
  let excluded = 0

  for (const input of inputs) {
    /*
     * The views only offer audits that produced findings, so this is never the
     * empty set in practice — an audit with no judgements on it is the checker
     * having broken, and scoring that 0 would file "we could not look" under
     * "we looked and it was fine". The fallback is here because a lead whose
     * findings were cascade-deleted between the two queries should score 0
     * rather than take the pass down.
     */
    const findings = findingsByAudit.get(input.auditId) ?? []
    const breakdown = scoreLead(findings, input.signals, SCORING_CONFIG)

    if (
      skipUnchanged &&
      input.current.configVersion === SCORING_CONFIG.version &&
      input.current.score === breakdown.score
    ) {
      unchanged += 1
      continue
    }

    if (breakdown.excluded) excluded += 1
    writes.push({ leadId: input.leadId, auditId: input.auditId, breakdown })
  }

  const scored = await writeScores(writes)
  return { scored, unchanged, excluded }
}

/**
 * Score whatever is waiting.
 *
 * Never throws. It runs after the response has been sent, alongside the audit
 * pass, and there is nobody left to tell — an unscored lead shows "not scored
 * yet" in the library, which is the honest outcome and self-correcting: the
 * next pass picks it up because the queue view still lists it.
 *
 * `leadIds` narrows it to a particular save or re-audit. Without it the pass
 * takes everything outstanding, which is what the library's poll wants.
 */
export async function runScoring(leadIds: string[] | null = null): Promise<ScoringPass> {
  try {
    // No skip test: the queue only lists leads with no score against their
    // newest audit, so every row it returns is by definition a change.
    return await scoreInputs(await readScoreQueue(leadIds), false)
  } catch (error) {
    console.error('[scoring] pass failed', error)
    return { ...EMPTY }
  }
}

/**
 * Re-rank the entire book against the current config.
 *
 * Throws, unlike the pass above: this one is a button the operator pressed and
 * is waiting on, so a failure is something he needs told rather than something
 * to swallow into a log he will never read.
 */
export async function rescoreBook(): Promise<ScoringPass> {
  return scoreInputs(await readAllScoringInputs(), true)
}

/** How many leads are waiting for a first score. Drives nothing; answers "is it done". */
export async function countUnscored(): Promise<number> {
  try {
    return (await readScoreQueue(null, 1000)).length
  } catch {
    return 0
  }
}
