import { after } from 'next/server'

import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { runEnrichment } from '@/lib/enrichment/run'
import { parseFilters } from '@/lib/leads/filters'
import { applyBulk, queryLeadIds } from '@/lib/leads/repository'
import { LEAD_STATUSES, type BulkAction, type LeadStatus } from '@/lib/leads/types'

/*
 * Bulk actions on a selection.
 *
 * The selection arrives one of two ways, and the difference matters. `ids` is
 * what the operator ticked and can see. `filters` is "everything matching this
 * view" — which may be four thousand rows he has never laid eyes on. Both are
 * legitimate; only the second needs a ceiling, and it gets one in the
 * repository rather than here.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseAction(raw: Record<string, unknown>): BulkAction | { error: string } {
  switch (raw.action) {
    case 'status': {
      const status = raw.status
      if (typeof status !== 'string' || !LEAD_STATUSES.includes(status as LeadStatus)) {
        return { error: 'That is not a status this product has.' }
      }
      return { action: 'status', status: status as LeadStatus }
    }

    case 'add_to_list': {
      const listId = typeof raw.listId === 'string' && raw.listId ? raw.listId : null
      const newListName = typeof raw.newListName === 'string' ? raw.newListName.trim() : null
      if (!listId && !newListName) return { error: 'Pick a list, or name a new one.' }
      return { action: 'add_to_list', listId, newListName }
    }

    case 'remove_from_list': {
      if (typeof raw.listId !== 'string' || !raw.listId) return { error: 'Which list?' }
      return { action: 'remove_from_list', listId: raw.listId }
    }

    case 'follow_up': {
      const value = raw.followUpAt
      if (value === null) return { action: 'follow_up', followUpAt: null }
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { error: 'A follow-up date must look like 2026-08-14.' }
      }
      return { action: 'follow_up', followUpAt: value }
    }

    case 'delete':
      return { action: 'delete' }
    case 'restore':
      return { action: 'restore' }
    case 're_audit':
      return { action: 're_audit' }

    default:
      return { error: 'Unknown action.' }
  }
}

export async function POST(request: Request) {
  try {
    await requireSession()
    const body = (await readJson(request)) as Record<string, unknown>

    const action = parseAction(body)
    if ('error' in action) return Response.json({ error: action.error }, { status: 400 })

    let ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : []

    // "Select all filtered" sends the filters instead of ten thousand ids. The
    // set is resolved here, against the same query the page was drawn from, so
    // the action touches exactly what the operator was looking at.
    if (!ids.length && typeof body.filters === 'string') {
      ids = await queryLeadIds(parseFilters(new URLSearchParams(body.filters)))
    }

    if (!ids.length) {
      return Response.json({ error: 'Nothing was selected.' }, { status: 400 })
    }

    const result = await applyBulk(ids, action)

    // Re-auditing is queued by the repository; draining it is this route's job,
    // after the operator already has his answer.
    if (action.action === 're_audit' && result.affected) {
      after(() => runEnrichment(ids))
    }

    return Response.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
