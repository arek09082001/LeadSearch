import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import type { SkipReason } from '@/lib/mcp/vocabulary'

/*
 * What the tools remember between calls.
 *
 * Three separate memories, and keeping them separate is what makes the storage
 * rule cheap:
 *
 *   `leads` + `skipped_places`  — every business already decided about. Read
 *                                 first, before anything is spent.
 *   `mcp_call_log`              — what each call did and what it consumed.
 *   `app_settings`              — the daily site-check allowance.
 *
 * The allowance is derived from the log rather than held in a counter, for the
 * same reason `lib/search/cost.ts` sums `api_usage` rather than trusting a
 * running total: this process may be a serverless invocation that did not exist
 * a second ago and will not exist a second from now. A counter in memory is a
 * ceiling that resets whenever the platform feels like it.
 */

/**
 * Which of these place IDs have already been decided about.
 *
 * One question, two tables, one round trip each — a lead and a rejection are
 * the same answer here ("do not look at this again"), and the caller has no
 * reason to tell them apart. A saved lead that was later deleted still counts:
 * the operator threw it out, and a tool that quietly put it back would be
 * overruling him with no way for him to notice.
 */
export async function readKnownPlaceIds(placeIds: string[]): Promise<Set<string>> {
  if (!placeIds.length) return new Set()

  const supabase = createServiceClient()
  const [leads, skipped] = await Promise.all([
    supabase.from('leads').select('google_place_id').in('google_place_id', placeIds),
    supabase.from('skipped_places').select('place_id').in('place_id', placeIds),
  ])

  /*
   * A failure here fails the run, and that is deliberate.
   *
   * Every other database failure in this codebase degrades — a lost cache write
   * costs a free replay, a lost note costs a note. This one cannot: not knowing
   * what is already saved means re-checking websites that were checked last
   * week and burning the day's allowance on answers we already had. Continuing
   * with an empty set would be the expensive kind of wrong.
   */
  if (leads.error) throw new Error(`Could not read the leads library: ${leads.error.message}`)
  if (skipped.error) throw new Error(`Could not read skipped places: ${skipped.error.message}`)

  const known = new Set<string>()
  for (const row of (leads.data ?? []) as { google_place_id: string }[]) {
    known.add(row.google_place_id)
  }
  for (const row of (skipped.data ?? []) as { place_id: string }[]) {
    known.add(row.place_id)
  }
  return known
}

/**
 * Write down what was rejected, so the next run does not pay to reject it again.
 *
 * `ignoreDuplicates` rather than an update: a place already in here was already
 * decided about, and moving its `checked_at` forward would make a judgement from
 * March look like one from this morning — which is exactly the field somebody
 * will later use to decide what deserves a second look.
 *
 * A failure is logged and swallowed. This table is an optimisation: losing a
 * write costs one wasted check next time, and failing the run over it would
 * throw away the leads that were saved in the same pass.
 */
export async function rememberSkipped(
  entries: { placeId: string; reason: SkipReason }[],
): Promise<number> {
  if (!entries.length) return 0

  const supabase = createServiceClient()
  const { error } = await supabase.from('skipped_places').upsert(
    entries.map((entry) => ({ place_id: entry.placeId, reason: entry.reason })),
    { onConflict: 'place_id', ignoreDuplicates: true },
  )

  if (error) {
    console.error('[mcp] could not remember skipped places', error.message)
    return 0
  }
  return entries.length
}

/**
 * Forget a rejection — the operator has overruled it.
 *
 * The one way back in for a business the rule threw away, and the reason
 * `save_leads` still exists now that saving is automatic. Without this, a place
 * rejected once would be permanently invisible to every future search, and the
 * operator's own judgement would have no way to beat the rule's.
 */
export async function forgetSkipped(placeIds: string[]): Promise<number> {
  if (!placeIds.length) return 0

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('skipped_places')
    .delete()
    .in('place_id', placeIds)
    .select('place_id')

  if (error) {
    console.error('[mcp] could not clear skipped places', error.message)
    return 0
  }
  return (data ?? []).length
}

/* ------------------------------------------------------------------------- *
 * The daily site-check allowance
 * ------------------------------------------------------------------------- */

export interface SiteCheckAllowance {
  limit: number
  usedToday: number
  remaining: number
}

/** Midnight UTC, matching the ledger's day. Not the operator's midnight, and it does not need to be. */
function startOfUtcDay(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

export async function readSiteCheckAllowance(): Promise<SiteCheckAllowance> {
  const supabase = createServiceClient()

  const [settings, today] = await Promise.all([
    supabase.from('app_settings').select('mcp_site_check_daily_limit').eq('id', true).single(),
    supabase.from('mcp_call_log').select('site_checks').gte('called_at', startOfUtcDay()),
  ])

  if (settings.error) throw new Error(`Could not read settings: ${settings.error.message}`)

  /*
   * A ledger we cannot read is treated as a ledger that is full.
   *
   * The opposite default — assume nothing has been spent — turns one database
   * hiccup into an unbounded run against strangers' servers. Failing closed
   * costs an afternoon of triage; failing open costs an apology.
   */
  if (today.error) {
    console.error('[mcp] could not read the site-check ledger', today.error.message)
    const limit = Number(settings.data.mcp_site_check_daily_limit)
    return { limit, usedToday: limit, remaining: 0 }
  }

  const limit = Number(settings.data.mcp_site_check_daily_limit)
  const usedToday = ((today.data ?? []) as { site_checks: number }[]).reduce(
    (sum, row) => sum + Number(row.site_checks ?? 0),
    0,
  )

  return { limit, usedToday, remaining: Math.max(0, limit - usedToday) }
}

/* ------------------------------------------------------------------------- *
 * The log
 * ------------------------------------------------------------------------- */

export interface McpCallRecord {
  tool: 'search_places' | 'save_leads'
  params: unknown
  savedCount: number
  skippedCount: number
  placesCalls: number
  siteChecks: number
  durationMs: number
  searchId?: string | null
  error?: string | null
}

/**
 * Record what the call did. Never fails the call.
 *
 * The asymmetry with `readSiteCheckAllowance` is intentional and worth stating,
 * because the two touch the same table: a missing WRITE costs one run's worth of
 * accounting, while a missing READ would remove the bound entirely. So the read
 * fails closed and the write shrugs — but loudly, because a log that quietly
 * stops being written is an allowance that quietly stops being enforced.
 */
export async function logMcpCall(record: McpCallRecord): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('mcp_call_log').insert({
    tool: record.tool,
    params: record.params ?? null,
    saved_count: record.savedCount,
    skipped_count: record.skippedCount,
    places_calls: record.placesCalls,
    site_checks: record.siteChecks,
    duration_ms: record.durationMs,
    search_id: record.searchId ?? null,
    error: record.error ?? null,
  })

  if (error) {
    console.error('[mcp] could not write the call log — the daily allowance is now under-counted', {
      tool: record.tool,
      siteChecks: record.siteChecks,
      error: error.message,
    })
  }
}
