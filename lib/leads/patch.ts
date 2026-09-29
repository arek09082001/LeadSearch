import type { LeadStatus } from '@/lib/leads/types'

/*
 * Changing one lead, from the browser.
 *
 * The route already treats a status, a date and a note as one action — it
 * writes them in one request and the status trigger logs the transition itself.
 * This is the client half of that promise, in one place, so the detail page and
 * the outreach queue cannot drift into sending two requests where the operator
 * made one decision.
 */

export interface LeadPatch {
  status?: LeadStatus
  /** `null` clears the date. Omitted leaves whatever is there. */
  followUpAt?: string | null
  note?: string
}

export function isEmptyPatch(patch: LeadPatch): boolean {
  return (
    patch.status === undefined && patch.followUpAt === undefined && !patch.note?.trim()
  )
}

export async function patchLead(id: string, patch: LeadPatch): Promise<void> {
  const response = await fetch(`/api/leads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    // The route names its own failures — an invalid status, a malformed date —
    // and those sentences are more use than anything restated here.
    throw new Error((body as { error?: string })?.error ?? 'The change could not be saved.')
  }
}
