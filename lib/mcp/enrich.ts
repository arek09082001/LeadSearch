import 'server-only'

import { after } from 'next/server'

import { runEnrichment } from '@/lib/enrichment/run'

/**
 * Hand new leads to the audit pass, behind the response.
 *
 * The same move `app/api/leads/route.ts` makes when the operator saves from the
 * Search surface, and it has to be made here too or a lead saved by a tool call
 * would sit at `enrichment_state: 'queued'` until somebody happened to open the
 * app. `search_places` decides unattended; the audit under its decisions cannot
 * depend on a browser arriving later.
 *
 * `after` throws outside a request scope. That is caught rather than allowed to
 * propagate: the leads are already written and returned, and losing the audit
 * is a lead that gets picked up on the next pass, while throwing here would
 * turn a completed save into a failed tool call.
 */
export function queueAudit(leadIds: string[]): void {
  if (!leadIds.length) return
  try {
    after(() => runEnrichment(leadIds))
  } catch (error) {
    console.warn('[mcp] could not schedule the audit pass; the leads are saved and queued', error)
  }
}
