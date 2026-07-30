import 'server-only'

import { CHECKER_VERSION, type Measurement } from '@/lib/enrichment/checker'
import type { Finding } from '@/lib/enrichment/findings'
import type { PageSpeed } from '@/lib/enrichment/pagespeed'
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

      psi_state: psiPending ? 'pending' : 'skipped',
      raw: measurement.raw,
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

  await supabase
    .from('leads')
    .update({ enrichment_state: 'done', enrichment_error: null })
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
  url: string
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
    .order('audited_at', { ascending: true })
    .limit(limit)

  const ids = ((queued ?? []) as { id: string }[]).map((row) => row.id)
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('lead_audits')
    .update({ psi_state: 'running', psi_checked_at: new Date().toISOString() })
    .in('id', ids)
    .eq('psi_state', 'pending')
    .select('id, final_url, website_url')

  if (error) {
    console.error('[enrichment] could not claim PageSpeed work', error.message)
    return []
  }

  return ((data ?? []) as { id: string; final_url: string | null; website_url: string | null }[])
    .map((row) => ({ auditId: row.id, url: row.final_url ?? row.website_url ?? '' }))
    .filter((job) => job.url)
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

export async function recordPerformance(auditId: string, psi: PageSpeed, findings: Finding[]) {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('lead_audits')
    .update({
      psi_state: psi.state,
      psi_performance: psi.performance,
      psi_lcp_ms: psi.lcpMs,
      psi_cls: psi.cls,
      psi_error: psi.error,
      psi_checked_at: psi.fetchedAt,
    })
    .eq('id', auditId)

  if (error) throw new Error(error.message)

  await writeFindings(auditId, findings)
}

/** How many PageSpeed jobs are still outstanding. Feeds the "auditing N" note. */
export async function countPendingPerformance(): Promise<number> {
  const { count } = await createServiceClient()
    .from('lead_audits')
    .select('id', { count: 'exact', head: true })
    .in('psi_state', ['pending', 'running'])

  return count ?? 0
}
