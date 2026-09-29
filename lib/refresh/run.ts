import 'server-only'

import { queueEnrichment } from '@/lib/enrichment/store'
import { getProvider } from '@/lib/providers'
import { BudgetExceededError, ProviderError } from '@/lib/providers/types'
import { diffSnapshots, delisted, type Snapshot } from '@/lib/refresh/diff'
import {
  claimStale,
  countStale,
  findStaleAudits,
  recordFailure,
  recordRefresh,
  reclaimStale,
  release,
  type RefreshClaim,
} from '@/lib/refresh/store'
import { SpendGuard } from '@/lib/search/cost'

/*
 * The refresh pass: asking Google whether anything has changed.
 *
 * PRODUCT.md makes two promises about the Google half of a lead — that it states
 * its age, and that it offers a refresh rather than pretending to be current.
 * The first has been kept since the schema was drawn. This is the second.
 *
 * TWO CLOCKS, and they are deliberately far apart.
 *
 *   The snapshot   — rating, reviews, phone, website — moves on the business's
 *                    own timescale, which is weeks. It is also the half Google's
 *                    terms restrict us from keeping indefinitely, so its cadence
 *                    is a compliance floor as much as a usefulness one.
 *   The audit      — what is wrong with the website — moves when somebody
 *                    rebuilds a site, which is years. Re-auditing on the
 *                    snapshot's clock would spend the PageSpeed quota measuring
 *                    the same unchanged site twelve times a year, and PageSpeed
 *                    is the one part of this pipeline that is rate-limited.
 *
 * The exception is what makes the whole thing worth building: when the refresh
 * finds that a lead has BUILT A WEBSITE, the audit on file is no longer about
 * this business at all — it says "no website", which is now false, and it is
 * carrying 45 of the 65 points that put the lead near the top of the book. That
 * lead is re-audited immediately, out of cadence, and the score that comes back
 * is lower with the reasoning attached. Same for a site that has gone away or
 * moved. See CHANGE_SPECS.invalidatesAudit.
 *
 * THIS PASS SPENDS MONEY. Every lead it looks at is one billable Place Details
 * request, so it goes through the same SpendGuard the search does and stops the
 * moment the ceiling refuses. That is also why it is not wired into any page
 * load: it runs on a schedule, or because the operator pressed something.
 */

/** The Google snapshot is considered stale after this. Matches the search-result retention window. */
export const SNAPSHOT_STALE_DAYS = 30
/** The audit is re-run after this. The slow clock. */
export const AUDIT_STALE_DAYS = 120

/** Leads refreshed per invocation. Each one is a billable request. */
const BATCH_LIMIT = 40
/** Requests in flight. Politeness to Google, not a throughput knob. */
const CONCURRENCY = 4
/** Leads handed back to the audit queue per invocation, on the slow clock. */
const RE_AUDIT_BATCH = 25
/** A claim older than this belonged to an invocation that died. */
const STALE_CLAIM_MINUTES = 10

/**
 * Stop STARTING work after this long.
 *
 * The route allows 60s. This leaves the margin to finish what is already in
 * flight and write it down, which is the difference between a pass that ends and
 * a pass that is killed holding claims.
 */
const SOFT_DEADLINE_MS = 45_000

export interface RefreshPass {
  /** Leads Google answered about this invocation. */
  refreshed: number
  /** Of those, how many had actually changed. */
  changed: number
  /** Leads re-queued for an audit, whether by cadence or because a change forced it. */
  reAudited: number
  /** Leads Google refused. Recorded on the lead, never on the business. */
  failed: number
  /** Set when the monthly ceiling stopped the pass. The pass ends; it does not throw. */
  stoppedBy: string | null
}

const EMPTY: RefreshPass = {
  refreshed: 0,
  changed: 0,
  reAudited: 0,
  failed: 0,
  stoppedBy: null,
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

function toSnapshot(place: {
  name: string | null
  website: string | null
  phone: string | null
  rating: number | null
  userRatingCount: number | null
  businessStatus: string | null
}): Snapshot {
  return {
    name: place.name,
    website: place.website,
    phone: place.phone,
    rating: place.rating,
    reviews: place.userRatingCount,
    businessStatus: place.businessStatus,
  }
}

/**
 * Does this failure mean the place is gone, rather than that the request broke?
 *
 * Google answers 404 for a place ID it has retired or merged. That is a fact
 * about the listing and gets recorded as one; everything else — 429, 500, a
 * timeout — is a fact about the request, and the lead is left exactly as it was
 * so the next pass can try again.
 */
function isDelisted(error: unknown): boolean {
  return error instanceof ProviderError && error.status === 404
}

export async function runRefresh(
  options: {
    leadIds?: string[] | null
    source?: 'scheduled' | 'manual'
    /** Skip the re-audit cadence sweep. A manual refresh of one lead has no business doing it. */
    includeCadence?: boolean
  } = {},
): Promise<RefreshPass> {
  const { leadIds = null, source = 'scheduled', includeCadence = leadIds === null } = options
  const deadline = Date.now() + SOFT_DEADLINE_MS
  const pass: RefreshPass = { ...EMPTY }

  try {
    await reclaimStale(STALE_CLAIM_MINUTES)

    const work = await claimStale(SNAPSHOT_STALE_DAYS, BATCH_LIMIT, leadIds)

    if (work.length) {
      const provider = getProvider()
      const guard = await SpendGuard.create()
      const needAudit: string[] = []
      // A holder rather than a `let`, so the pool's halt test reads what the
      // workers wrote. A captured local reassigned inside a callback is exactly
      // the shape the checker stops narrowing correctly.
      const halt: { reason: string | null } = { reason: null }

      const refreshOne = async (lead: RefreshClaim) => {
        try {
          const { place } = await provider.getDetails(lead.googlePlaceId, guard)
          const delta = diffSnapshots(lead.snapshot, toSnapshot(place))
          const outcome = await recordRefresh(lead, delta, source, place.raw)

          pass.refreshed += 1
          if (outcome.changed) pass.changed += 1
          if (outcome.reAudit) needAudit.push(lead.id)
        } catch (error) {
          /*
           * The ceiling is not a failure and must not be recorded as one on the
           * lead. It halts the pass: every remaining claim is released
           * untouched, and the next run picks the queue up where this left it.
           */
          if (error instanceof BudgetExceededError) {
            halt.reason = error.message
            await release([lead.id])
            return
          }

          if (isDelisted(error)) {
            const delta = delisted(lead.snapshot)
            await recordRefresh(lead, delta, source, undefined).catch(() => {})
            pass.refreshed += 1
            pass.changed += 1
            return
          }

          const message =
            error instanceof Error ? error.message : 'The refresh failed unexpectedly.'
          console.error('[refresh] failed', { leadId: lead.id, message })
          await recordFailure(lead.id, message).catch(() => {})
          pass.failed += 1
        }
      }

      const unstarted = await pooled(
        work,
        CONCURRENCY,
        deadline,
        () => halt.reason !== null,
        refreshOne,
      )
      await release(unstarted.map((lead) => lead.id))
      pass.stoppedBy = halt.reason

      /*
       * The whole reason the pass exists. A lead that has built a website is
       * still sitting on an audit that says it has none — worth 45 points and
       * most of its position in the book — so it goes back to the front of the
       * audit queue rather than waiting out the slow clock.
       */
      if (needAudit.length) {
        pass.reAudited += await queueEnrichment(needAudit)
      }
    }

    /*
     * The slow clock, and only when nothing above cut the pass short. Re-auditing
     * on cadence is the least urgent thing this pass does, and doing it while the
     * budget guard is refusing would be spending the next invocation's time on it.
     */
    if (includeCadence && !pass.stoppedBy && Date.now() < deadline) {
      const stale = await findStaleAudits(AUDIT_STALE_DAYS, RE_AUDIT_BATCH)
      if (stale.length) pass.reAudited += await queueEnrichment(stale)
    }
  } catch (error) {
    // Never throws: it runs after the response has been sent, so there is
    // nobody left to tell. The queue is self-correcting — a released claim is
    // simply picked up next time.
    console.error('[refresh] pass failed', error)
  }

  return pass
}

/** How much the refresh has waiting, across both clocks. Answers "is it done". */
export async function countRefreshDue(): Promise<{ snapshots: number; audits: number }> {
  const [snapshots, audits] = await Promise.all([
    countStale(SNAPSHOT_STALE_DAYS),
    findStaleAudits(AUDIT_STALE_DAYS, 1000).then((ids) => ids.length),
  ])
  return { snapshots, audits }
}
