import 'server-only'

import { CHECKER_VERSION, type Measurement } from '@/lib/enrichment/checker'
import type { Finding } from '@/lib/enrichment/findings'
import type { ImprintMeasurement } from '@/lib/enrichment/imprint'
import type { PageSpeed } from '@/lib/enrichment/pagespeed'
import { discardScreenshots, storeScreenshot } from '@/lib/enrichment/screenshot'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * Where an audit is written down.
 *
 * Split out from `run.ts` so that scheduling — who is claimed, in what order,
 * under what deadline — never has to be read alongside column names. The two
 * change for entirely different reasons.
 *
 * Everything here is append-only in spirit. A re-audit is a NEW lead_audits row
 * with new findings, never an edit of an old one; the only UPDATE in the file
 * is the PageSpeed stage completing the row it already owns.
 */

export interface AuditWrite {
  auditId: string
  /** Whether this audit is now waiting on the PageSpeed stage. */
  psiPending: boolean
}

/**
 * Should Google be asked to profile this?
 *
 * Only a real site that answered. Running PageSpeed against a Facebook page
 * would measure Facebook's engineering, score it well, and quietly file that
 * against a business whose actual problem is not having a website.
 */
function shouldProfile(measurement: Measurement): boolean {
  return (
    measurement.websiteStatus === 'reachable' &&
    measurement.presenceKind === 'site' &&
    Boolean(measurement.finalUrl)
  )
}

/**
 * Write the audit and its diagnosis, in that order.
 *
 * The order matters: the trigger on lead_audit_findings folds the failed codes
 * back onto the audit row, so the findings have to arrive second or there is
 * nothing to fold them onto.
 */
export async function writeAudit(
  leadId: string,
  measurement: Measurement,
  imprint: ImprintMeasurement | null,
  findings: Finding[],
): Promise<AuditWrite> {
  const supabase = createServiceClient()
  const psiPending = shouldProfile(measurement)

  /*
   * The audit row is written even when the site did not answer. "Unreachable,
   * checked an hour ago" is a finding the operator can act on; a lead with no
   * audit row at all is indistinguishable from one that was never tried.
   *
   * The insert trigger updates leads.latest_audit_id and last_audited_at, so
   * nothing here touches those columns.
   */
  const { data, error } = await supabase
    .from('lead_audits')
    .insert({
      lead_id: leadId,
      checker_version: CHECKER_VERSION,
      website_url: measurement.websiteUrl,
      final_url: measurement.finalUrl,
      website_status: measurement.websiteStatus,
      http_status: measurement.httpStatus,
      duration_ms: measurement.durationMs,
      error: measurement.error,

      dns_resolves: measurement.dnsResolves,
      is_https: measurement.isHttps,
      tls_valid: measurement.tlsValid,
      tls_expires_at: measurement.tlsExpiresAt,
      is_mobile_friendly: measurement.isMobileFriendly,
      has_title: measurement.hasTitle,
      has_meta_description: measurement.hasMetaDescription,
      has_favicon: measurement.hasFavicon,
      is_table_layout: measurement.isTableLayout,
      load_ms: measurement.loadMs,
      copyright_year: measurement.copyrightYear,
      platform: measurement.platform,
      platform_version: measurement.platformVersion,
      presence_kind: measurement.presenceKind,

      imprint_url: imprint?.imprintUrl ?? null,
      imprint_has_address: imprint?.hasAddress ?? null,
      imprint_has_phone: imprint?.hasPhone ?? null,
      imprint_has_email: imprint?.hasEmail ?? null,
      imprint_has_vat_id: imprint?.hasVatId ?? null,
      has_privacy_policy: imprint?.hasPrivacyPolicy ?? null,
      loads_external_fonts: imprint?.loadsExternalFonts ?? null,
      has_external_maps: imprint?.hasExternalMaps ?? null,
      contact_form_insecure: imprint?.contactFormInsecure ?? null,

      psi_state: psiPending ? 'pending' : 'skipped',
      /*
       * The lookup's own state rides in `raw` rather than in a tenth column.
       * It is the difference between "we looked and there is none" and "the
       * lookup broke", which the judge needs and no query filters on — the
       * same bargain `raw.freeSubdomain` and `raw.datedMarkers` already struck.
       */
      raw: imprint
        ? {
            ...(measurement.raw ?? {}),
            imprint: {
              state: imprint.state,
              error: imprint.error,
              attempts: imprint.attempts,
              consentManager: imprint.consentManager,
              linksReadable: imprint.linksReadable,
              durationMs: imprint.durationMs,
            },
          }
        : measurement.raw,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  const auditId = (data as { id: string }).id

  await writeFindings(auditId, findings)

  /*
   * Retire any PageSpeed job still outstanding against an OLDER audit of this
   * lead. Without this, a re-audit before the first one finished would leave a
   * job in the queue whose result nobody would ever look at — and the "auditing
   * N" count would never reach zero.
   */
  await supabase
    .from('lead_audits')
    .update({ psi_state: 'skipped', psi_error: 'Superseded by a newer audit.' })
    .eq('lead_id', leadId)
    .neq('id', auditId)
    .in('psi_state', ['pending', 'running'])

  /*
   * The lead's own row: the pass is done, and possibly an address to write to.
   *
   * ONLY WHEN THE LOOKUP REACHED A VERDICT. On 'found' the two contact columns
   * are written; on 'absent' they are written as null, because a business that
   * has taken its Impressum down should not keep advertising the address we
   * scraped off it last month. On 'error' — and when the stage did not run at
   * all — they are left strictly alone: a timeout is not evidence that an
   * address stopped existing, and letting a bad minute on the network delete
   * the one email address in the book would be the worst kind of quiet loss.
   */
  const settled = imprint !== null && imprint.state !== 'error'

  await supabase
    .from('leads')
    .update({
      enrichment_state: 'done',
      enrichment_error: null,
      ...(settled
        ? {
            imprint_email: imprint.email,
            imprint_phone: imprint.phone,
            imprint_fetched_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq('id', leadId)

  return { auditId, psiPending }
}

/**
 * One insert for the whole diagnosis.
 *
 * Deliberately a single statement rather than a row at a time: the trigger that
 * folds failed codes onto the audit is statement-level, so one insert means one
 * recomputation instead of twenty.
 */
export async function writeFindings(auditId: string, findings: Finding[]): Promise<void> {
  if (!findings.length) return

  const { error } = await createServiceClient()
    .from('lead_audit_findings')
    .insert(
      findings.map((entry) => ({
        audit_id: auditId,
        code: entry.code,
        category: entry.category,
        severity: entry.severity,
        passed: entry.passed,
        value: entry.value,
        message: entry.message,
      })),
    )

  if (error) throw new Error(error.message)
}

/**
 * Mark leads for the background pass. Returns how many are now waiting.
 *
 * Here rather than in the leads repository, even though it writes to `leads`:
 * it is the enrichment queue's own door, and three callers need it — saving,
 * the bulk re-audit, and the refresh pass when a change makes an audit wrong.
 * Putting it in the repository made the refresh pass import the repository,
 * which imports the refresh pass, and a module cycle is not a thing to leave
 * lying under a background job.
 */
export async function queueEnrichment(leadIds: string[]): Promise<number> {
  if (!leadIds.length) return 0

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('leads')
    .update({
      enrichment_state: 'queued',
      enrichment_queued_at: new Date().toISOString(),
      enrichment_error: null,
    })
    .in('id', leadIds)
    .select('id')

  if (error) {
    console.error('[enrichment] could not queue enrichment', error.message)
    return 0
  }
  return data?.length ?? 0
}

export async function failLead(leadId: string, message: string): Promise<void> {
  await createServiceClient()
    .from('leads')
    .update({ enrichment_state: 'failed', enrichment_error: message.slice(0, 500) })
    .eq('id', leadId)
}

/* ------------------------------------------------------------------------- *
 * The PageSpeed stage
 * ------------------------------------------------------------------------- */

export interface PerformanceJob {
  auditId: string
  /**
   * Carried alongside the audit because the screenshot prune is scoped to the
   * lead, not to the audit: when a new frame lands, the frames belonging to that
   * lead's EARLIER audits are the ones that stop being worth storing.
   */
  leadId: string
  url: string
  /** How many times PageSpeed has already been asked about this audit. */
  attempts: number
}

/**
 * Take the PageSpeed queue's next slice, atomically.
 *
 * Same shape as the lead claim in `run.ts` and for the same reason: two tabs
 * polling at once would otherwise both profile the same audit, spend two calls
 * against a rate-limited quota, and collide on the unique (audit_id, code)
 * constraint when they both wrote the result.
 */
export async function claimPerformanceWork(limit: number): Promise<PerformanceJob[]> {
  const supabase = createServiceClient()

  // PostgREST has no LIMIT on UPDATE, so the slice is chosen first and then
  // claimed by id. The state predicate is what makes the claim exclusive.
  const { data: queued } = await supabase
    .from('lead_audits')
    .select('id')
    .eq('psi_state', 'pending')
    /*
     * A job Google told us to come back for is invisible until it is time.
     * Without this the pass would re-offer a rate-limited job immediately, spend
     * a call to be refused again, and burn the attempt budget in one invocation
     * — which is the exact failure a back-off exists to prevent.
     */
    .or(`psi_retry_after.is.null,psi_retry_after.lt."${new Date().toISOString()}"`)
    .order('audited_at', { ascending: true })
    .limit(limit)

  const ids = ((queued ?? []) as { id: string }[]).map((row) => row.id)
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('lead_audits')
    .update({ psi_state: 'running', psi_checked_at: new Date().toISOString() })
    .in('id', ids)
    .eq('psi_state', 'pending')
    .select('id, lead_id, final_url, website_url, psi_attempts')

  if (error) {
    console.error('[enrichment] could not claim PageSpeed work', error.message)
    return []
  }

  return ((data ?? []) as {
    id: string
    lead_id: string
    final_url: string | null
    website_url: string | null
    psi_attempts: number | null
  }[])
    .map((row) => ({
      auditId: row.id,
      leadId: row.lead_id,
      url: row.final_url ?? row.website_url ?? '',
      attempts: row.psi_attempts ?? 0,
    }))
    .filter((job) => job.url)
}

/**
 * How long to wait before asking PageSpeed about this audit again.
 *
 * Doubling, from a minute, with a ceiling. A rate limit on the shared per-IP
 * quota clears in seconds to minutes; one on a keyed quota is a daily budget and
 * clears in hours. The ceiling is what stops the second case turning into a
 * retry every minute for the rest of the day.
 *
 * No jitter, deliberately. Jitter exists to stop a fleet of clients
 * synchronising, and there is exactly one of these.
 */
function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000)
}

/**
 * Past this, a refusal stops being temporary.
 *
 * Four attempts spans roughly a quarter of an hour of back-off. Something still
 * refusing after that is not a passing limit, and the audit is entitled to say
 * so rather than sit `pending` for ever with the library counting it as work
 * outstanding.
 */
const MAX_PSI_ATTEMPTS = 4

/**
 * Put back jobs that were claimed and then not attempted.
 *
 * Distinct from the stale sweep below: nothing was asked of Google, so no
 * attempt is spent and no back-off is written. The rate-limit breaker is the
 * only caller — it stops a pass mid-batch, and the jobs it stopped are owed
 * straight back to the queue rather than left to time out.
 */
export async function releasePerformance(auditIds: string[]): Promise<void> {
  if (!auditIds.length) return

  await createServiceClient()
    .from('lead_audits')
    .update({ psi_state: 'pending' })
    .in('id', auditIds)
    .eq('psi_state', 'running')
}

/** Put back any PageSpeed job an invocation died holding. */
export async function reclaimStalePerformance(staleMinutes: number): Promise<void> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString()

  await createServiceClient()
    .from('lead_audits')
    .update({ psi_state: 'pending' })
    .eq('psi_state', 'running')
    .lt('psi_checked_at', cutoff)
}

/**
 * Write what PageSpeed said, or arrange to ask again.
 *
 * `attempts` is what the job was claimed with, so a retryable refusal on the
 * first attempt waits a minute, on the second two, and so on — and past
 * `MAX_PSI_ATTEMPTS` it becomes an ordinary failure with the last reason on it.
 *
 * The retry path deliberately writes NO findings and leaves the score columns
 * alone. The audit is not finished; saying it scored nothing would be a
 * judgement, and the whole reason for the retry is that no judgement was reached.
 */
export async function recordPerformance(job: PerformanceJob, psi: PageSpeed, findings: Finding[]) {
  const supabase = createServiceClient()
  const { auditId, attempts } = job

  const retrying = psi.retryable && attempts < MAX_PSI_ATTEMPTS

  /*
   * The screenshot is written BEFORE the row, and only when the run settled.
   *
   * Before, because the column is what makes the object findable: an object
   * written after a successful update would be unreferenced for the width of the
   * gap, and if the invocation died in that gap it would be unreferenced for
   * ever. This ordering can only leave the opposite kind of orphan — bytes in
   * the bucket that no row points at — which the prune below and the next audit
   * both clean up.
   *
   * Only when it settled, because the retry path deliberately writes nothing:
   * `psi.screenshot` is null on every failure anyway, and uploading on a run we
   * are about to ask again would spend the write twice.
   */
  const screenshotPath =
    !retrying && psi.screenshot ? await storeScreenshot(auditId, psi.screenshot) : null

  const patch: Record<string, unknown> = retrying
    ? {
        psi_state: 'pending',
        psi_attempts: attempts + 1,
        psi_retry_after: new Date(Date.now() + backoffMs(attempts + 1)).toISOString(),
        psi_error: psi.error,
        psi_checked_at: psi.fetchedAt,
      }
    : {
        psi_state: psi.state,
        psi_attempts: attempts + 1,
        psi_retry_after: null,
        psi_performance: psi.performance,
        psi_lcp_ms: psi.lcpMs,
        psi_cls: psi.cls,
        psi_error:
          psi.retryable && psi.error
            ? `${psi.error} Gave up after ${attempts + 1} attempts.`
            : psi.error,
        psi_checked_at: psi.fetchedAt,
        screenshot_path: screenshotPath,
      }

  const { error } = await supabase.from('lead_audits').update(patch).eq('id', auditId)
  if (error) {
    /*
     * The bytes are in the bucket and the row that would have named them is not.
     * Drop them rather than leave an object nothing will ever point at or find:
     * the audit is going to be retried or re-run, and the frame it takes then is
     * the one that will be referenced.
     */
    if (screenshotPath) await discardScreenshots([screenshotPath]).catch(() => {})
    throw new Error(error.message)
  }

  if (screenshotPath) await pruneScreenshots(job.leadId, auditId)

  if (!retrying) await writeFindings(auditId, findings)
}

/**
 * Keep one screenshot per lead — this one.
 *
 * Storage grows with the size of the book rather than with how often it has been
 * audited, which at a monthly ceiling of zero is the difference between fitting
 * in the free tier and not: the operator re-audits, and a year of monthly
 * re-audits without this would store twelve pictures of every website he has
 * ever looked at to show one.
 *
 * Nothing is lost that anybody could see. The lead page renders the newest
 * audit's screenshot; earlier audits appear in the history as one line each, and
 * a line does not carry a picture.
 *
 * Best-effort throughout, and ordered so it cannot destroy evidence it has not
 * already disowned: the column is cleared FIRST, so a failure to delete leaves
 * unreferenced bytes rather than a row pointing at an object that is gone.
 */
async function pruneScreenshots(leadId: string, keepAuditId: string): Promise<void> {
  try {
    const supabase = createServiceClient()

    /*
     * Read the keys BEFORE clearing them, and not from the UPDATE's own
     * RETURNING: PostgREST returns the row as it now stands, so selecting
     * `screenshot_path` back off the update that nulls it yields a column of
     * nulls and deletes nothing. Two statements, in this order, is the only
     * shape that both clears the reference first and still knows what it freed.
     */
    const { data: doomed } = await supabase
      .from('lead_audits')
      .select('id, screenshot_path')
      .eq('lead_id', leadId)
      .neq('id', keepAuditId)
      .not('screenshot_path', 'is', null)

    const rows = (doomed ?? []) as { id: string; screenshot_path: string | null }[]
    const paths = rows
      .map((row) => row.screenshot_path)
      .filter((path): path is string => Boolean(path))
    if (!paths.length) return

    await supabase
      .from('lead_audits')
      .update({ screenshot_path: null })
      .in(
        'id',
        rows.map((row) => row.id),
      )

    await discardScreenshots(paths)
  } catch (error) {
    // A screenshot that outlives its usefulness costs kilobytes. Failing the
    // PageSpeed result over it would cost the scores.
    console.error('[enrichment] could not prune screenshots', { leadId, error })
  }
}

/** How many PageSpeed jobs are still outstanding. Feeds the "auditing N" note. */
export async function countPendingPerformance(): Promise<number> {
  const { count } = await createServiceClient()
    .from('lead_audits')
    .select('id', { count: 'exact', head: true })
    .in('psi_state', ['pending', 'running'])

  return count ?? 0
}
