import 'server-only'

import { measureWebsite } from '@/lib/enrichment/checker'
import { judgeMeasurement, judgePerformance } from '@/lib/enrichment/findings'
import { hasPageSpeedKey, measurePageSpeed } from '@/lib/enrichment/pagespeed'
import {
  claimPerformanceWork,
  countPendingPerformance,
  failLead,
  reclaimStalePerformance,
  recordPerformance,
  releasePerformance,
  writeAudit,
  type PerformanceJob,
} from '@/lib/enrichment/store'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * The background pass, in two stages.
 *
 * Saving must feel instant, and auditing twelve websites does not. So the save
 * route marks its leads `queued` and returns; this drains the queue afterwards,
 * inside `after()`, on the same request's compute. The queue is a column rather
 * than a message broker on purpose — with one operator and a few dozen saves a
 * session, a table you can read in the UI beats infrastructure you cannot.
 *
 * WHY TWO STAGES. The fast checks take a second or two per site. PageSpeed
 * takes twenty, sometimes forty, because Google is really loading the page on a
 * simulated phone. Running them together would mean a lead sits with no
 * diagnosis at all for as long as the slowest thing in its batch, and a batch of
 * any size would outlive the function.
 *
 * So stage one writes the audit row and the whole front-door diagnosis at once —
 * the row lights up in the library within seconds — and marks the audit
 * `psi_state = 'pending'`. Stage two drains that queue separately, filling in
 * the same audit row as the scores arrive. A lead is never blocked on Google,
 * and the library can show both states honestly.
 *
 * The consequence to design around, in both stages: this process can vanish
 * mid-run. A serverless invocation ends when it ends. Hence every claim is a
 * state with a timestamp, anything held too long is put back, and nothing is
 * started that cannot plausibly finish before the deadline below.
 */

/** Websites audited at once. Politeness to their servers, not a throughput knob. */
const CONCURRENCY = 4
/** Ceiling per invocation, working with the soft deadline rather than instead of it. */
const BATCH_LIMIT = 12
/** A claim older than this belonged to an invocation that died. */
const STALE_CLAIM_MINUTES = 10

/**
 * PageSpeed jobs in flight, and the batch they come from.
 *
 * Sized by whether a key is configured, because the two cases have quotas that
 * differ by three orders of magnitude. With a key it is 25,000 requests a day
 * and they are ours. Without one the quota is per-IP and shared with everything
 * else running on the host, which on a serverless platform means everything else
 * on that machine — four calls at once there is a way to be rate-limited on
 * purpose, and a bulk re-audit is what proves it.
 *
 * Read through functions rather than as constants because `hasPageSpeedKey()`
 * reads the environment, and a module-level constant would freeze the answer at
 * import time.
 */
const psiConcurrency = () => (hasPageSpeedKey() ? 4 : 1)
const psiBatch = () => (hasPageSpeedKey() ? 4 : 2)
/** Shorter than the lead claim: a PageSpeed job either answers within 35s or never. */
const PSI_STALE_MINUTES = 3

/**
 * Stop STARTING work after this long.
 *
 * The route allows 60s. This leaves the margin to finish whatever is already in
 * flight and write it down, which is the difference between a pass that ends
 * and a pass that is killed holding claims.
 */
const SOFT_DEADLINE_MS = 50_000
/**
 * PageSpeed is only started with room for its own timeout to expire first.
 *
 * Otherwise the invocation dies mid-call and the job sits in `running` until
 * the stale sweep three minutes later — during which the library keeps saying
 * it is auditing something that nobody is auditing.
 */
const PSI_MIN_REMAINING_MS = 38_000

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

  await createServiceClient()
    .from('leads')
    .update({ enrichment_state: 'queued', enrichment_started_at: null })
    .eq('enrichment_state', 'running')
    .lt('enrichment_started_at', cutoff)
}

/** Hand back work the deadline stopped us starting, so the next pass takes it. */
async function release(leadIds: string[]): Promise<void> {
  if (!leadIds.length) return

  await createServiceClient()
    .from('leads')
    .update({ enrichment_state: 'queued', enrichment_started_at: null })
    .in('id', leadIds)
    .eq('enrichment_state', 'running')
}

/**
 * Run `worker` over `items`, at most `limit` in flight, starting nothing after
 * `deadline` or once `halted` is set. Returns whatever it never started, which
 * the caller owes back to the queue.
 */
async function pooled<T>(
  items: T[],
  limit: number,
  deadline: number,
  halted: () => boolean,
  worker: (item: T) => Promise<void>,
): Promise<T[]> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (Date.now() >= deadline || halted()) return
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)

  return items.slice(Math.min(cursor, items.length))
}

/* ------------------------------------------------------------------------- *
 * Stage one — the front door
 * ------------------------------------------------------------------------- */

async function auditOne(lead: Claim): Promise<void> {
  try {
    const measurement = await measureWebsite(lead.website)
    await writeAudit(lead.id, measurement, judgeMeasurement(measurement))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The audit failed unexpectedly.'
    console.error('[enrichment] audit failed', { leadId: lead.id, message })
    await failLead(lead.id, message).catch(() => {})
  }
}

/* ------------------------------------------------------------------------- *
 * Stage two — PageSpeed
 * ------------------------------------------------------------------------- */

async function profileOne(job: PerformanceJob, limited: { hit: boolean }): Promise<void> {
  try {
    const psi = await measurePageSpeed(job.url)

    /*
     * The circuit breaker. Once Google has refused once in this invocation, the
     * remaining jobs will be refused too — the limit is per key or per IP, not
     * per request — and starting them spends the retry budget of four more
     * audits to learn the same thing. So the first refusal stops the pass, and
     * the back-off written by `recordPerformance` decides when to try again.
     */
    if (psi.retryable) limited.hit = true

    await recordPerformance(job, psi, judgePerformance(psi))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PageSpeed failed unexpectedly.'
    console.error('[enrichment] pagespeed failed', { auditId: job.auditId, message })

    /*
     * Recorded on the audit, never on the lead. The lead's own audit succeeded
     * and its diagnosis is already on screen; only the scores are missing, and
     * marking the whole lead `failed` over that would hide a good diagnosis
     * behind a Google outage.
     *
     * Retryable, because this branch is reached only by something throwing —
     * `measurePageSpeed` never does, so anything here is the database or the
     * runtime, neither of which is a verdict on the website.
     */
    await recordPerformance(
      job,
      {
        state: 'failed',
        retryable: true,
        performance: null,
        lcpMs: null,
        cls: null,
        error: message,
        testedUrl: job.url,
        fetchedAt: new Date().toISOString(),
        reportUrl: null,
        screenshot: null,
      },
      [],
    ).catch(() => {})
  }
}

/**
 * Drain as much of the PageSpeed queue as the remaining time allows.
 *
 * Nothing is claimed that cannot finish, so a pass with no room simply returns
 * 0 and the next poll picks the queue up where this left it.
 */
async function runPerformance(deadline: number): Promise<number> {
  if (deadline - Date.now() < PSI_MIN_REMAINING_MS) return 0

  await reclaimStalePerformance(PSI_STALE_MINUTES)

  const jobs = await claimPerformanceWork(psiBatch())
  if (!jobs.length) return 0

  const limited = { hit: false }

  // No deadline inside this pool: every job was claimed knowing its own timeout
  // fits in the time left, and abandoning one mid-flight would spend a call
  // against a rate-limited quota for nothing. The halt test is the rate-limit
  // breaker — jobs it stops are still `pending` and come back on the next pass.
  const unstarted = await pooled(
    jobs,
    psiConcurrency(),
    Infinity,
    () => limited.hit,
    (job) => profileOne(job, limited),
  )

  if (unstarted.length) {
    // Put back what the breaker stopped, with no attempt spent on it: it was
    // never asked, so it is not on its second try.
    await releasePerformance(unstarted.map((job) => job.auditId))
  }

  return jobs.length - unstarted.length
}

/* ------------------------------------------------------------------------- *
 * The pass
 * ------------------------------------------------------------------------- */

export interface EnrichmentPass {
  /** Leads that got an audit row and a diagnosis this invocation. */
  audited: number
  /** Audits that got their PageSpeed scores this invocation. */
  profiled: number
}

/**
 * Drain the enrichment queue.
 *
 * Never throws and never rejects: it runs after the response has been sent, so
 * there is no one left to tell. A lead whose audit fails is marked `failed`
 * with the reason on it, which is where the operator will actually see it.
 */
export async function runEnrichment(leadIds: string[] | null = null): Promise<EnrichmentPass> {
  const deadline = Date.now() + SOFT_DEADLINE_MS
  const pass: EnrichmentPass = { audited: 0, profiled: 0 }

  try {
    await reclaimStale()

    const work = await claim(leadIds, BATCH_LIMIT)
    if (work.length) {
      const unstarted = await pooled(work, CONCURRENCY, deadline, () => false, auditOne)
      await release(unstarted.map((lead) => lead.id))
      pass.audited = work.length - unstarted.length
    }

    pass.profiled = await runPerformance(deadline)
  } catch (error) {
    console.error('[enrichment] pass failed', error)
  }

  return pass
}

/**
 * How much is still waiting, across both stages.
 *
 * Drives the "auditing N" note in the library and the poll that keeps the pass
 * moving. Counting only the first stage would make the note vanish while every
 * row was still waiting on its scores.
 */
export async function countPending(): Promise<number> {
  const supabase = createServiceClient()

  const [leads, performance] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .in('enrichment_state', ['queued', 'running'])
      .is('deleted_at', null),
    countPendingPerformance(),
  ])

  return (leads.count ?? 0) + performance
}
