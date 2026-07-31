import 'server-only'

import { invalidatesAudit } from '@/lib/leads/changes'
import { createServiceClient } from '@/lib/supabase/server'
import type { Delta, Snapshot } from '@/lib/refresh/diff'

/*
 * Where a refresh is claimed and written down.
 *
 * Split from `run.ts` for the reason the enrichment store is split from its
 * pass: scheduling — who is due, in what order, under what deadline — never has
 * to be read alongside column names.
 *
 * The one rule this file exists to hold: `fetched_at` moves only when Google
 * actually answered. It is the age of the snapshot beside it, and a refresh that
 * failed has not made that snapshot any younger. Every surface in the product
 * states that number, so a pass that touched it on the way past would make the
 * whole book claim to be current on the strength of a request that 500'd.
 */

/** One lead the refresh pass is holding. */
export interface RefreshClaim {
  id: string
  googlePlaceId: string
  snapshot: Snapshot
}

interface LeadRecord {
  id: string
  google_place_id: string
  name: string | null
  website: string | null
  phone: string | null
  rating: number | string | null
  user_rating_count: number | null
  business_status: string | null
}

function toClaim(record: LeadRecord): RefreshClaim {
  return {
    id: record.id,
    googlePlaceId: record.google_place_id,
    snapshot: {
      name: record.name,
      website: record.website,
      phone: record.phone,
      // numeric(2,1) arrives as a string from PostgREST, as everywhere else.
      rating: record.rating === null ? null : Number(record.rating),
      reviews: record.user_rating_count,
      businessStatus: record.business_status,
    },
  }
}

const CLAIM_COLUMNS =
  'id, google_place_id, name, website, phone, rating, user_rating_count, business_status'

function isoAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** How long a lead Google refused is left alone before it is offered again. */
const FAILURE_BACKOFF_DAYS = 3

/**
 * Take the next slice of stale leads, atomically.
 *
 * Same shape as the enrichment claim, and for the same reason: the scheduled
 * pass and a manual refresh can overlap, and two claims of one lead would spend
 * two billable Place Details calls to learn the same thing twice.
 *
 * `refresh_started_at` is both the claim and its own expiry. PostgREST has no
 * LIMIT on UPDATE, so the slice is chosen first and claimed by id; the null
 * check in the UPDATE is what actually makes the claim exclusive.
 */
export async function claimStale(
  staleAfterDays: number,
  limit: number,
  leadIds: string[] | null = null,
): Promise<RefreshClaim[]> {
  const supabase = createServiceClient()

  let due = supabase
    .from('leads')
    .select('id')
    .is('deleted_at', null)
    .is('refresh_started_at', null)
    // Oldest snapshot first: the pass is bounded, and the row that has been
    // wrong longest is the one worth a call this week.
    .order('fetched_at', { ascending: true })
    .limit(limit)

  if (leadIds?.length) {
    // A named refresh is the operator asking about these leads now. Staleness
    // is the scheduler's rule, not his, so it does not apply.
    due = due.in('id', leadIds)
  } else {
    due = due.lt('fetched_at', isoAgo(staleAfterDays))
    /*
     * Anything that failed recently is left alone. Google refusing once is
     * usually Google refusing for a while, and a pass that retried the same
     * hundred leads every night would spend the month's Place Details
     * allowance on the same hundred failures.
     */
    due = due.or(`refresh_failed_at.is.null,refresh_failed_at.lt."${isoAgo(FAILURE_BACKOFF_DAYS)}"`)
  }

  const { data: candidates, error: readError } = await due
  if (readError) {
    console.error('[refresh] could not read the queue', readError.message)
    return []
  }

  const ids = ((candidates ?? []) as { id: string }[]).map((row) => row.id)
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('leads')
    .update({ refresh_started_at: new Date().toISOString() })
    .in('id', ids)
    .is('refresh_started_at', null)
    .select(CLAIM_COLUMNS)

  if (error) {
    console.error('[refresh] could not claim work', error.message)
    return []
  }
  return ((data ?? []) as unknown as LeadRecord[]).map(toClaim)
}

/** Put back anything a dead invocation is still holding. */
export async function reclaimStale(staleMinutes: number): Promise<void> {
  await createServiceClient()
    .from('leads')
    .update({ refresh_started_at: null })
    .not('refresh_started_at', 'is', null)
    .lt('refresh_started_at', new Date(Date.now() - staleMinutes * 60_000).toISOString())
}

/** Hand back work the deadline stopped us starting, so the next pass takes it. */
export async function release(leadIds: string[]): Promise<void> {
  if (!leadIds.length) return

  await createServiceClient()
    .from('leads')
    .update({ refresh_started_at: null })
    .in('id', leadIds)
}

/* ------------------------------------------------------------------------- *
 * Writing the outcome
 * ------------------------------------------------------------------------- */

export interface RefreshOutcome {
  /** True when a change was recorded and therefore something is worth showing. */
  changed: boolean
  /** True when the change makes the audit on file describe a different site. */
  reAudit: boolean
}

/**
 * Record a refresh that Google answered.
 *
 * The snapshot columns are overwritten and `fetched_at` moves — that is the
 * whole point of the pass. Nothing else on the lead is touched: status, notes,
 * score, follow-up and audit history are the operator's work product and have
 * never depended on how old the Google half is.
 *
 * A `lead_refreshes` row is written only when something moved. See the migration
 * for why: `fetched_at` already records that we asked.
 */
export async function recordRefresh(
  lead: RefreshClaim,
  delta: Delta,
  source: 'scheduled' | 'manual',
  raw: unknown,
): Promise<RefreshOutcome> {
  const supabase = createServiceClient()
  const after = delta.after
  const changed = delta.codes.length > 0

  const patch: Record<string, unknown> = {
    fetched_at: new Date().toISOString(),
    refresh_started_at: null,
    refresh_failed_at: null,
    refresh_error: null,
  }

  /*
   * `delisted` is the one outcome that writes no new values.
   *
   * Google has retired the place ID, so there is nothing to copy in — and the
   * snapshot on file is now the operator's only record of a business he may
   * still want to phone. Overwriting it with nulls would destroy that to record
   * the fact that Google forgot them.
   */
  if (!delta.codes.includes('delisted')) {
    patch.name = after.name ?? lead.snapshot.name
    patch.website = after.website
    patch.phone = after.phone
    patch.rating = after.rating
    patch.user_rating_count = after.reviews
    patch.business_status = after.businessStatus
    if (raw !== undefined) patch.place_snapshot = raw
  }

  const { error } = await supabase.from('leads').update(patch).eq('id', lead.id)
  if (error) throw new Error(error.message)

  if (!changed) return { changed: false, reAudit: false }

  const { error: writeError } = await supabase.from('lead_refreshes').insert({
    lead_id: lead.id,
    source,
    changes: delta.codes,
    before: delta.before,
    after: delta.after,
  })

  /*
   * A lost change row does not fail the refresh. The snapshot is already
   * correct, which is the part that matters; losing the note that says how it
   * got that way is an annoyance, and one worth a log rather than a rollback.
   */
  if (writeError) {
    console.error('[refresh] could not record the change', {
      leadId: lead.id,
      error: writeError.message,
    })
    return { changed: true, reAudit: invalidatesAudit(delta.codes) }
  }

  return { changed: true, reAudit: invalidatesAudit(delta.codes) }
}

/**
 * Record a refresh Google refused.
 *
 * `fetched_at` deliberately does not move. The claim is released and the failure
 * is stamped so the back-off in `claimStale` can see it.
 */
export async function recordFailure(leadId: string, message: string): Promise<void> {
  const supabase = createServiceClient()

  await supabase
    .from('leads')
    .update({
      refresh_started_at: null,
      refresh_failed_at: new Date().toISOString(),
      refresh_error: message.slice(0, 500),
    })
    .eq('id', leadId)

  const { error } = await supabase.from('lead_refreshes').insert({
    lead_id: leadId,
    source: 'scheduled',
    changes: [],
    error: message.slice(0, 500),
  })

  if (error) console.error('[refresh] could not record the failure', error.message)
}

/* ------------------------------------------------------------------------- *
 * Reading it back
 * ------------------------------------------------------------------------- */

/** How many live leads are past the staleness line and not currently held. */
export async function countStale(staleAfterDays: number): Promise<number> {
  const { count } = await createServiceClient()
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .lt('fetched_at', isoAgo(staleAfterDays))

  return count ?? 0
}

/**
 * Leads whose audit is older than the re-audit cadence.
 *
 * Separate from the snapshot's own staleness and on a much slower clock: a
 * business's review count moves monthly, its website does not. Re-auditing on
 * the snapshot's cadence would spend the PageSpeed quota re-measuring sites that
 * nobody has touched since the last time.
 */
export async function findStaleAudits(
  staleAfterDays: number,
  limit: number,
): Promise<string[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .is('deleted_at', null)
    // Only leads that HAVE an audit. One that has never been audited belongs to
    // the enrichment queue, which has its own path to it, and picking it up here
    // would race that pass for the same lead.
    .not('last_audited_at', 'is', null)
    .lt('last_audited_at', isoAgo(staleAfterDays))
    // Anything already in the enrichment queue is somebody else's work. Written
    // as an explicit null branch because `not in` over a null column evaluates
    // to null, which would silently drop every lead whose state was never set.
    .or('enrichment_state.is.null,enrichment_state.not.in.("queued","running")')
    .order('last_audited_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[refresh] could not read the re-audit queue', error.message)
    return []
  }
  return ((data ?? []) as { id: string }[]).map((row) => row.id)
}

/** One lead's refresh history, newest first. Feeds the timeline on its page. */
export interface RefreshRecord {
  id: string
  refreshedAt: string
  source: string
  changes: string[]
  before: Snapshot | null
  after: Snapshot | null
  error: string | null
}

export async function readRefreshes(leadId: string, limit = 50): Promise<RefreshRecord[]> {
  const { data } = await createServiceClient()
    .from('lead_refreshes')
    .select('id, refreshed_at, source, changes, before, after, error')
    .eq('lead_id', leadId)
    .order('refreshed_at', { ascending: false })
    .limit(limit)

  return ((data ?? []) as {
    id: string
    refreshed_at: string
    source: string
    changes: string[] | null
    before: Snapshot | null
    after: Snapshot | null
    error: string | null
  }[]).map((row) => ({
    id: row.id,
    refreshedAt: row.refreshed_at,
    source: row.source,
    changes: row.changes ?? [],
    before: row.before,
    after: row.after,
    error: row.error,
  }))
}
