import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import type {
  BusinessSignals,
  ScorableFinding,
  ScoreBreakdown,
  StoredScore,
} from '@/lib/scoring/score'

/*
 * Where a score comes from and where it goes.
 *
 * Split from `score.ts` for the reason that file is pure: the arithmetic must
 * stay runnable without a database, because that is what makes re-ranking the
 * whole book after a config edit cost nothing. Everything that knows a column
 * name is here.
 *
 * Nothing in this file touches `leads.current_score`. That column is maintained
 * by the trigger on `lead_scores`, and writing it from the application as well
 * would give two writers to one value — the exact drift the denormalisation was
 * set up to avoid. Insert the score row; the lead catches up by itself.
 */

/** One lead's inputs, as the queue views hand them over. */
export interface ScoringInput {
  leadId: string
  auditId: string
  signals: BusinessSignals
  /** The score already on the lead, and the config that produced it. Null when unscored. */
  current: { score: number | null; configVersion: string | null }
}

interface InputRecord {
  lead_id: string
  audit_id: string
  rating: number | string | null
  user_rating_count: number | null
  business_status: string | null
  current_score?: number | null
  current_config_version?: string | null
}

function toInput(record: InputRecord): ScoringInput {
  return {
    leadId: record.lead_id,
    auditId: record.audit_id,
    signals: {
      // numeric(2,1) arrives as a string from PostgREST, as everywhere else.
      rating: record.rating === null || record.rating === undefined ? null : Number(record.rating),
      reviews: record.user_rating_count ?? null,
      businessStatus: record.business_status,
    },
    current: {
      score: record.current_score ?? null,
      configVersion: record.current_config_version ?? null,
    },
  }
}

const QUEUE_COLUMNS = 'lead_id, audit_id, rating, user_rating_count, business_status'
const RESCORE_COLUMNS =
  'lead_id, audit_id, rating, user_rating_count, business_status, current_score, current_config_version'

/**
 * Leads whose newest audit has settled without a score computed against it.
 *
 * The incremental work list. `leadIds` narrows it to a specific save or
 * re-audit; without it the pass takes whatever is outstanding, which is what
 * the library's poll wants.
 */
export async function readScoreQueue(
  leadIds: string[] | null = null,
  limit = 500,
): Promise<ScoringInput[]> {
  let query = createServiceClient()
    .from('lead_score_queue')
    .select(QUEUE_COLUMNS)
    .limit(limit)

  if (leadIds?.length) query = query.in('lead_id', leadIds)

  const { data, error } = await query
  if (error) throw new Error(`Could not read the scoring queue: ${error.message}`)
  return ((data ?? []) as unknown as InputRecord[]).map(toInput)
}

/**
 * Every live lead that can be scored, whether or not it already is.
 *
 * What a rescore reads after the config changed. Paged rather than limited: a
 * rescore that silently stopped at the first five hundred would leave the book
 * ranked under two different sets of weights, which is worse than not ranked.
 */
export async function readAllScoringInputs(pageSize = 1000): Promise<ScoringInput[]> {
  const supabase = createServiceClient()
  const inputs: ScoringInput[] = []

  for (let page = 0; ; page += 1) {
    const from = page * pageSize
    const { data, error } = await supabase
      .from('lead_scoring_inputs')
      .select(RESCORE_COLUMNS)
      // Stable across pages. Without it Postgres is free to return the same row
      // twice and skip another, which is how a rescore misses leads.
      .order('lead_id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Could not read the leads to rescore: ${error.message}`)

    const rows = (data ?? []) as unknown as InputRecord[]
    inputs.push(...rows.map(toInput))
    if (rows.length < pageSize) return inputs
  }
}

/**
 * The findings of the given audits, keyed by audit.
 *
 * Two columns and nothing else. The scorer reads a code and a verdict; pulling
 * the messages and the evidence jsonb along would be most of a megabyte of
 * sales copy fetched to add up some integers.
 */
export async function readFindingsByAudit(
  auditIds: string[],
): Promise<Map<string, ScorableFinding[]>> {
  const byAudit = new Map<string, ScorableFinding[]>()
  if (!auditIds.length) return byAudit

  const supabase = createServiceClient()

  // Chunked because the ids go into the URL as a PostgREST `in.()` list, and a
  // few thousand uuids is a request line no proxy will accept.
  const CHUNK = 200
  for (let index = 0; index < auditIds.length; index += CHUNK) {
    const slice = auditIds.slice(index, index + CHUNK)
    const { data, error } = await supabase
      .from('lead_audit_findings')
      .select('audit_id, code, passed')
      .in('audit_id', slice)

    if (error) throw new Error(`Could not read the findings to score: ${error.message}`)

    for (const row of (data ?? []) as { audit_id: string; code: string; passed: boolean }[]) {
      const existing = byAudit.get(row.audit_id)
      if (existing) existing.push({ code: row.code, passed: row.passed })
      else byAudit.set(row.audit_id, [{ code: row.code, passed: row.passed }])
    }
  }

  return byAudit
}

export interface ScoreWrite {
  leadId: string
  auditId: string
  breakdown: ScoreBreakdown
}

/**
 * Append the scores. One statement per chunk, never one per lead.
 *
 * The whole breakdown goes into `factors`, not just the list of faults: the
 * multiplier that was applied, the tier that chose it, and the exclusion rule
 * when there is one. Six months from now the config will have moved on, and a
 * stored score that cannot reproduce its own arithmetic is a number with an
 * opinion attached and no argument.
 */
export async function writeScores(writes: ScoreWrite[]): Promise<number> {
  if (!writes.length) return 0

  const supabase = createServiceClient()
  const CHUNK = 500
  let written = 0

  for (let index = 0; index < writes.length; index += CHUNK) {
    const payload = writes.slice(index, index + CHUNK).map((write) => ({
      lead_id: write.leadId,
      audit_id: write.auditId,
      score: write.breakdown.score,
      config_version: write.breakdown.configVersion,
      factors: write.breakdown,
    }))

    const { data, error } = await supabase.from('lead_scores').insert(payload).select('id')
    if (error) throw new Error(`Could not write the scores: ${error.message}`)
    written += data?.length ?? 0
  }

  return written
}

/* ------------------------------------------------------------------------- *
 * Reading one back
 * ------------------------------------------------------------------------- */

/**
 * Is this jsonb the breakdown this build knows how to render?
 *
 * Every field the diagnosis reaches into is checked, not a sample of them. The
 * whole point of storing the breakdown is that it outlives the code that wrote
 * it, so an older row reaching a renderer that assumes a newer shape is the
 * expected case rather than the impossible one — and it has to come back null
 * and say so, not throw halfway down a lead's page.
 */
function asBreakdown(value: unknown): ScoreBreakdown | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ScoreBreakdown>

  if (!Array.isArray(candidate.factors)) return null
  if (typeof candidate.points !== 'number') return null
  if (typeof candidate.strength !== 'number') return null
  if (!candidate.signal || typeof candidate.signal !== 'object') return null
  if (typeof candidate.signal.multiplier !== 'number') return null
  if (!candidate.scale || typeof candidate.scale.fullScale !== 'number') return null

  return candidate as ScoreBreakdown
}

/**
 * The score currently on a lead, with the reasoning that produced it.
 *
 * Read through `leads.current_score_id` rather than by taking the newest row
 * for the lead, so this and the number in the table are guaranteed to be the
 * same score. Two different ways of asking "the current score" is how a
 * breakdown ends up explaining a number that is not on screen.
 */
export async function readCurrentScore(leadId: string): Promise<StoredScore | null> {
  const supabase = createServiceClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('current_score_id')
    .eq('id', leadId)
    .maybeSingle()

  const scoreId = (lead as { current_score_id: string | null } | null)?.current_score_id
  if (!scoreId) return null

  const { data } = await supabase
    .from('lead_scores')
    .select('id, score, config_version, computed_at, factors')
    .eq('id', scoreId)
    .maybeSingle()

  if (!data) return null
  const record = data as {
    id: string
    score: number | null
    config_version: string
    computed_at: string
    factors: unknown
  }

  return toStored(record)
}

function toStored(record: {
  id: string
  score: number | null
  config_version: string
  computed_at: string
  factors: unknown
}): StoredScore {
  return {
    id: record.id,
    score: record.score,
    configVersion: record.config_version,
    computedAt: record.computed_at,
    breakdown: asBreakdown(record.factors),
  }
}

/**
 * The score before the one currently on the lead.
 *
 * Ordered exactly as the denormalisation trigger orders — `computed_at desc, id
 * desc` — and then stepped past the current row rather than filtered by
 * timestamp. Two scores written in the same statement share a `computed_at` to
 * the microsecond, and a `< computed_at` predicate would silently skip one of
 * them or return the current score as its own predecessor.
 *
 * Null when this lead has only ever been scored once, which is not a gap: a
 * first score has not moved.
 */
export async function readPreviousScore(leadId: string): Promise<StoredScore | null> {
  const supabase = createServiceClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('current_score_id')
    .eq('id', leadId)
    .maybeSingle()

  const currentId = (lead as { current_score_id: string | null } | null)?.current_score_id
  if (!currentId) return null

  const { data } = await supabase
    .from('lead_scores')
    .select('id, score, config_version, computed_at, factors')
    .eq('lead_id', leadId)
    .order('computed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(2)

  const rows = (data ?? []) as {
    id: string
    score: number | null
    config_version: string
    computed_at: string
    factors: unknown
  }[]

  const index = rows.findIndex((row) => row.id === currentId)
  // The current score not being in the newest two means something newer exists
  // that the trigger has not caught up with. Saying nothing is better than
  // comparing against a row that is not the one on screen.
  if (index === -1) return null

  const previous = rows[index + 1]
  return previous ? toStored(previous) : null
}
