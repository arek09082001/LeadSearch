import 'server-only'

import { CHECKER_VERSION, measureWebsite, type Measurement } from '@/lib/enrichment/checker'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * The background pass.
 *
 * Saving must feel instant, and auditing twelve websites does not. So the save
 * route marks its leads `queued` and returns; this drains the queue afterwards,
 * inside `after()`, on the same request's compute. The queue is a column rather
 * than a message broker on purpose — with one operator and a few dozen saves a
 * session, a table you can read in the UI beats infrastructure you cannot.
 *
 * The consequence to design around: this process can vanish mid-run. A serverless
 * invocation ends when it ends. Hence `running` is a claimed state with a
 * timestamp, and anything left holding it too long is put back.
 */

/** Websites audited at once. Politeness to their servers, not a throughput knob. */
const CONCURRENCY = 4
/** Ceiling per invocation, so a 500-lead re-audit cannot outlive the function. */
const BATCH_LIMIT = 25
/** A claim older than this belonged to an invocation that died. */
const STALE_CLAIM_MINUTES = 10

interface Claim {
  id: string
  website: string | null
}

/**
 * Take the queue's next slice, atomically.
 *
 * One UPDATE ... RETURNING, not a SELECT followed by an UPDATE: two tabs
 * saving at once would otherwise both claim the same leads and audit each one
 * twice. Narrowing on `enrichment_state = 'queued'` is what makes the claim
 * exclusive — the second writer matches nothing.
 */
async function claim(leadIds: string[] | null, limit: number): Promise<Claim[]> {
  const supabase = createServiceClient()

  // PostgREST has no LIMIT on UPDATE, so the slice is chosen first and then
  // claimed by id. The state predicate below still makes the claim exclusive.
  let selectQueued = supabase
    .from('leads')
    .select('id')
    .eq('enrichment_state', 'queued')
    .is('deleted_at', null)
    .order('enrichment_queued_at', { ascending: true })
    .limit(limit)

  if (leadIds?.length) selectQueued = selectQueued.in('id', leadIds)

  const { data: queued } = await selectQueued
  const ids = ((queued ?? []) as { id: string }[]).map((row) => row.id)
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('leads')
    .update({ enrichment_state: 'running', enrichment_started_at: new Date().toISOString() })
    .in('id', ids)
    .eq('enrichment_state', 'queued')
    .select('id, website')

  if (error) {
    console.error('[enrichment] could not claim work', error.message)
    return []
  }
  return (data ?? []) as Claim[]
}

/** Put back anything a dead invocation is still holding. */
async function reclaimStale(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString()
  const supabase = createServiceClient()

  await supabase
    .from('leads')
    .update({ enrichment_state: 'queued', enrichment_started_at: null })
    .eq('enrichment_state', 'running')
    .lt('enrichment_started_at', cutoff)
}

async function record(leadId: string, measurement: Measurement): Promise<void> {
  const supabase = createServiceClient()

  /*
   * The audit row is written even when the site did not answer. "Unreachable,
   * checked an hour ago" is a finding the operator can act on; a lead with no
   * audit row at all is indistinguishable from one that was never tried.
   *
   * The insert trigger updates leads.latest_audit_id and last_audited_at, so
   * nothing here touches those columns.
   */
  const { error } = await supabase.from('lead_audits').insert({
    lead_id: leadId,
    checker_version: CHECKER_VERSION,
    website_url: measurement.websiteUrl,
    final_url: measurement.finalUrl,
    website_status: measurement.websiteStatus,
    http_status: measurement.httpStatus,
    duration_ms: measurement.durationMs,
    error: measurement.error,
    is_https: measurement.isHttps,
    is_mobile_friendly: measurement.isMobileFriendly,
    has_meta_description: measurement.hasMetaDescription,
    load_ms: measurement.loadMs,
    copyright_year: measurement.copyrightYear,
    platform: measurement.platform,
    raw: measurement.raw,
  })

  if (error) throw new Error(error.message)

  await supabase
    .from('leads')
    .update({ enrichment_state: 'done', enrichment_error: null })
    .eq('id', leadId)
}

async function fail(leadId: string, message: string): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('leads')
    .update({ enrichment_state: 'failed', enrichment_error: message.slice(0, 500) })
    .eq('id', leadId)
}

/** Run `worker` over `items`, at most `limit` in flight. */
async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

/**
 * Drain the enrichment queue.
 *
 * Never throws and never rejects: it runs after the response has been sent, so
 * there is no one left to tell. A lead whose audit fails is marked `failed`
 * with the reason on it, which is where the operator will actually see it.
 */
export async function runEnrichment(leadIds: string[] | null = null): Promise<number> {
  try {
    await reclaimStale()

    const work = await claim(leadIds, BATCH_LIMIT)
    if (!work.length) return 0

    await pooled(work, CONCURRENCY, async (lead) => {
      try {
        const measurement = await measureWebsite(lead.website)
        await record(lead.id, measurement)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The audit failed unexpectedly.'
        console.error('[enrichment] audit failed', { leadId: lead.id, message })
        await fail(lead.id, message).catch(() => {})
      }
    })

    return work.length
  } catch (error) {
    console.error('[enrichment] pass failed', error)
    return 0
  }
}

/** How much is still waiting. Drives the "auditing N" note in the library. */
export async function countPending(): Promise<number> {
  const supabase = createServiceClient()
  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('enrichment_state', ['queued', 'running'])
    .is('deleted_at', null)
  return count ?? 0
}
