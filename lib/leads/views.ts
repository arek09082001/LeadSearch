import 'server-only'

import { coerceFilters, filtersToJson } from '@/lib/leads/filters'
import type { LeadFilters, SavedView } from '@/lib/leads/types'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * Saved views: a filter set with a name on it.
 *
 * "No website, Heilbronn, score > 70" is a question the operator asks weekly.
 * Rebuilding it from six controls every time is the kind of small tax that
 * turns a filter bar into something you stop using.
 *
 * Stored as the filter state, never as SQL. A view written today has to keep
 * working after the query builder is rewritten, and the only way to promise
 * that is to store the question rather than its translation.
 */

interface ViewRecord {
  id: string
  name: string
  filters: unknown
  position: number
  last_used_at: string | null
}

function toView(record: ViewRecord): SavedView {
  return {
    id: record.id,
    name: record.name,
    // Parsed through the codec, so a view stored before a filter existed — or
    // one hand-edited in the table — widens to a valid set instead of throwing.
    filters: coerceFilters(record.filters),
    position: record.position,
    lastUsedAt: record.last_used_at,
  }
}

export async function readViews(): Promise<SavedView[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('saved_views')
    .select('id, name, filters, position, last_used_at')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    // A broken views table must not take the library down with it: the views
    // are a shortcut, and the filter bar underneath them still works.
    console.error('[views] could not read saved views', error.message)
    return []
  }
  return ((data ?? []) as ViewRecord[]).map(toView)
}

export async function createView(name: string, filters: LeadFilters): Promise<SavedView> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A view needs a name.')
  if (trimmed.length > 60) throw new Error('That name is too long (max 60 characters).')

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('saved_views')
    .insert({ name: trimmed, filters: filtersToJson(filters) })
    .select('id, name, filters, position, last_used_at')
    .single()

  if (error) {
    // The unique index on lower(name) is doing its job; say so in words.
    if (error.code === '23505') throw new Error(`You already have a view called "${trimmed}".`)
    throw new Error(`Could not save the view: ${error.message}`)
  }
  return toView(data as ViewRecord)
}

/** Overwrite a view's filters with the current ones, keeping its name. */
export async function updateView(id: string, filters: LeadFilters): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('saved_views')
    .update({ filters: filtersToJson(filters) })
    .eq('id', id)
  if (error) throw new Error(`Could not update the view: ${error.message}`)
}

export async function renameView(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A view needs a name.')

  const supabase = createServiceClient()
  const { error } = await supabase.from('saved_views').update({ name: trimmed }).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error(`You already have a view called "${trimmed}".`)
    throw new Error(`Could not rename the view: ${error.message}`)
  }
}

export async function deleteView(id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('saved_views').delete().eq('id', id)
  if (error) throw new Error(`Could not delete the view: ${error.message}`)
}

/** Fire-and-forget: knowing which views are cold is worth more than the write. */
export async function touchView(id: string): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('saved_views')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', id)
}
