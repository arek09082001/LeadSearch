import 'server-only'

import {
  WORKED_STATUSES,
  outcomeOf,
  summariseOutcomes,
  type OutcomeReport,
  type WorkedLead,
} from '@/lib/insight/outcomes'
import type { LeadStatus } from '@/lib/leads/types'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * Where the evidence comes from. Four reads and no new storage.
 *
 * Everything this page needs has been recorded since the schema was drawn:
 * `lead_scores` is append-only and carries its whole breakdown, `lead_activities`
 * has had every status transition written into it by trigger from the first
 * migration, and `leads.status` holds the outcome. Nothing had ever asked the
 * question, which is not the same as nothing having kept the answer.
 *
 * TWO DECISIONS ARE MADE HERE, and both are about which fact is the honest one.
 *
 * FIRST, WHICH LEADS WERE WORKED. The current status is not enough: a lead
 * called in May and parked in June reads as `parked` today, and dropping it
 * would quietly delete the calls that went nowhere — which is exactly the half
 * of the sample that keeps a rate from flattering the weights. So the outreach
 * log is read as well, and any lead that has EVER entered a worked status
 * counts, whatever it says now.
 *
 * SECOND, WHICH DIAGNOSIS. Not the one on the lead today — the one it carried
 * when it was first called. The difference is not academic and shows up twice:
 *
 *   - A lead called because it had no website, which then built one, is
 *     re-audited into a completely different set of faults. Reading today's
 *     breakdown would credit the close to a diagnosis that was never pitched.
 *   - An afternoon of tuning followed by a rescore rewrites the NUMBER on every
 *     lead in the book. Reading today's score would re-band every call ever made
 *     against weights that did not exist when it was made — so the page would
 *     change its answer every time the operator acted on it, which is the one
 *     behaviour that would make it useless for deciding anything.
 *
 * `lead_scores` being append-only is what makes that possible at all, and this
 * is the first thing to actually need it.
 */

/**
 * PostgREST answers at most a thousand rows, and says nothing when it truncates.
 *
 * Every read below therefore pages rather than trusting one round trip. A page
 * whose whole point is an honest sample must not be built on a query that
 * silently stops at a thousand rows — it would go on rendering rates, and they
 * would just quietly be about a subset of the book.
 */
const PAGE = 1000

/**
 * Ids per `in.()` list. The scoring store chunks at 200 for the same reason —
 * the ids travel in the request line — and this one is smaller because each id
 * here can bring several score rows back with it.
 */
const CHUNK = 100

/** Enough of a PostgREST response to page it and to fail on it. */
type Answer = { data: unknown; error: { message: string } | null }

/**
 * Read every row of an ordered query, a page at a time.
 *
 * The query must carry a total order. Without one Postgres is free to return a
 * row twice across two pages and skip another, which is the same silent
 * inaccuracy the paging exists to avoid — see the note in `readAllScoringInputs`.
 */
async function readPaged<T>(
  what: string,
  run: (from: number, to: number) => PromiseLike<Answer>,
): Promise<T[]> {
  const rows: T[] = []

  for (let page = 0; ; page += 1) {
    const from = page * PAGE
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) throw new Error(`Could not read ${what}: ${error.message}`)

    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE) return rows
  }
}

function chunked<T>(values: T[]): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += CHUNK) {
    chunks.push(values.slice(index, index + CHUNK))
  }
  return chunks
}

interface StatusRecord {
  id: string
  status: LeadStatus
}

interface ContactRecord {
  lead_id: string
  occurred_at: string
}

/** A score row, identified and dated. Deliberately without its breakdown. */
interface ScoreStamp {
  id: string
  lead_id: string
  computed_at: string
}

/** The breakdown, fetched only for the score rows that were actually chosen. */
interface ScoreBody {
  id: string
  score: number | null
  config_version: string
  factors: unknown
}

/**
 * The faults a stored breakdown was computed from.
 *
 * Null when the jsonb is not a shape this build can read — an older score, or
 * one written before `factors` held the whole breakdown. Distinguished from an
 * empty list, which is a real diagnosis that found nothing wrong, because the
 * two mean opposite things to a sample: one is a lead with a clean site, the
 * other is a lead we cannot say anything about and must not count as clean.
 *
 * Only failed findings are in there — `scoreLead` filters the passes out before
 * it writes — so this is the diagnosis as it was pitched, not the check list.
 */
function diagnosisFrom(factors: unknown): string[] | null {
  if (!factors || typeof factors !== 'object') return null

  const list = (factors as { factors?: unknown }).factors
  if (!Array.isArray(list)) return null

  const codes: string[] = []
  for (const entry of list) {
    const code = (entry as { code?: unknown } | null)?.code
    if (typeof code === 'string') codes.push(code)
  }
  return codes
}

/**
 * The score the lead was carrying when it was called.
 *
 * `history` is ascending. Three cases, and the fallbacks are the interesting
 * part:
 *
 *   - Called after it was scored: the newest score at or before the call. The
 *     ordinary case, and the one the whole page rests on.
 *   - Called before it was ever scored — a lead rung off the search results, or
 *     audited late: the earliest score there is. Closer to the site as it stood
 *     on the call than today's would be, and honest about being a stand-in.
 *   - No contact date at all, which is a lead whose transition predates the log:
 *     the current score, matching what the book shows for it.
 */
function scoreAtContact(
  history: ScoreStamp[],
  contactedAt: string | null,
): { chosen: ScoreStamp; rescoredSince: boolean } | null {
  if (!history.length) return null

  const newest = history[history.length - 1]
  let chosen = newest

  if (contactedAt) {
    const called = Date.parse(contactedAt)
    // Timestamps are compared as instants rather than as strings: PostgREST
    // renders timestamptz with an offset, and two rows written either side of a
    // configuration change can carry different ones.
    const before = history.filter((row) => Date.parse(row.computed_at) <= called)
    chosen = before.length ? before[before.length - 1] : history[0]
  }

  return { chosen, rescoredSince: chosen.id !== newest.id }
}

/**
 * Every lead that was ever worked, with the diagnosis it was worked on.
 *
 * Deleted leads are left out. The bin is where mistakes go, and a lead the
 * operator threw away is not a call he is asking to be judged on.
 */
async function readWorkedLeads(): Promise<WorkedLead[]> {
  const supabase = createServiceClient()

  const [current, events] = await Promise.all([
    readPaged<StatusRecord>('the worked leads', (from, to) =>
      supabase
        .from('leads')
        .select('id, status')
        .is('deleted_at', null)
        .in('status', [...WORKED_STATUSES])
        .order('id', { ascending: true })
        .range(from, to),
    ),
    /*
     * Every transition INTO a worked status, oldest first. The first one per
     * lead is the moment it was first reached out to — which is the instant the
     * diagnosis has to be read at, and the reason this is a log read rather than
     * a column read. A lead rung, then parked, then rung again is dated by the
     * first call, because that is the one its score was on the list for.
     */
    readPaged<ContactRecord>('the outreach log', (from, to) =>
      supabase
        .from('lead_activities')
        .select('lead_id, occurred_at')
        .eq('type', 'status_change')
        .in('status_after', [...WORKED_STATUSES])
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])

  const statuses = new Map<string, LeadStatus>(current.map((row) => [row.id, row.status]))

  const contactedAt = new Map<string, string>()
  for (const event of events) {
    if (!contactedAt.has(event.lead_id)) contactedAt.set(event.lead_id, event.occurred_at)
  }

  /*
   * Leads the log knows were worked and the status column no longer says so:
   * parked afterwards, or moved back to `new`. Their current status still
   * decides the outcome — a lead parked after a call has not been won and has
   * not been lost — but they belong in the sample, and dropping them would leave
   * a rate computed only over the leads that stayed in the queue.
   */
  const strays = [...contactedAt.keys()].filter((id) => !statuses.has(id))
  for (const chunk of chunked(strays)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, status')
      .is('deleted_at', null)
      .in('id', chunk)

    if (error) throw new Error(`Could not read the worked leads: ${error.message}`)
    for (const row of (data ?? []) as unknown as StatusRecord[]) statuses.set(row.id, row.status)
  }

  const leadIds = [...statuses.keys()]
  if (!leadIds.length) return []

  /*
   * The score history, without the breakdowns.
   *
   * Three columns first, then the jsonb for the handful of rows that turn out to
   * matter. A book tuned over an afternoon has several score rows per lead and
   * each breakdown is a page of sales copy — fetching all of them to read one
   * per lead would be most of the payload, thrown away on arrival.
   */
  const stamps: ScoreStamp[] = []
  for (const chunk of chunked(leadIds)) {
    stamps.push(
      ...(await readPaged<ScoreStamp>('the score history', (from, to) =>
        supabase
          .from('lead_scores')
          .select('id, lead_id, computed_at')
          .in('lead_id', chunk)
          .order('lead_id', { ascending: true })
          .order('computed_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      )),
    )
  }

  const history = new Map<string, ScoreStamp[]>()
  for (const stamp of stamps) {
    const existing = history.get(stamp.lead_id)
    if (existing) existing.push(stamp)
    else history.set(stamp.lead_id, [stamp])
  }

  const chosen = new Map<string, { chosen: ScoreStamp; rescoredSince: boolean }>()
  for (const [leadId, rows] of history) {
    const pick = scoreAtContact(rows, contactedAt.get(leadId) ?? null)
    if (pick) chosen.set(leadId, pick)
  }

  const bodies = new Map<string, ScoreBody>()
  for (const chunk of chunked([...chosen.values()].map((pick) => pick.chosen.id))) {
    const { data, error } = await supabase
      .from('lead_scores')
      .select('id, score, config_version, factors')
      .in('id', chunk)

    if (error) throw new Error(`Could not read the score breakdowns: ${error.message}`)
    for (const row of (data ?? []) as unknown as ScoreBody[]) bodies.set(row.id, row)
  }

  return leadIds.map((id) => {
    const pick = chosen.get(id)
    const body = pick ? bodies.get(pick.chosen.id) : undefined

    return {
      id,
      outcome: outcomeOf(statuses.get(id)!),
      score: body ? body.score : null,
      codes: body ? diagnosisFrom(body.factors) : null,
      configVersion: body ? body.config_version : null,
      rescoredSince: pick?.rescoredSince ?? false,
    }
  })
}

/** The whole page, in one call. Reads the book; writes nothing, ever. */
export async function readOutcomes(): Promise<OutcomeReport> {
  return summariseOutcomes(await readWorkedLeads())
}
