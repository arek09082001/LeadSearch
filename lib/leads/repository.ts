import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import {
  PAGE_SIZE,
  type AuditFinding,
  type AuditSummary,
  type BulkAction,
  type BulkResult,
  type EnrichmentState,
  type LeadAudit,
  type LeadDetail,
  type LeadFacets,
  type LeadFilters,
  type LeadListing,
  type LeadRow,
  type LeadStatus,
  type PsiState,
  type SaveRequest,
  type SaveResult,
  type SaveResultItem,
  type WebsiteStatus,
} from '@/lib/leads/types'
import type { FindingSeverity } from '@/lib/enrichment/vocabulary'

/*
 * Everything the permanent side reads and writes.
 *
 * The counterpart to lib/search/repository.ts, and the only module allowed to
 * create a lead. That asymmetry is the product's central rule expressed in
 * code: discovery may only ever *read* `leads`, and a row appears here because
 * saveLeads() was called by a route the operator deliberately hit.
 */

/** The `leads_library` view, as it comes back over the wire. */
interface LibraryRecord {
  id: string
  google_place_id: string
  name: string
  formatted_address: string | null
  city: string | null
  phone: string | null
  website: string | null
  rating: number | string | null
  user_rating_count: number | null
  primary_type: string | null
  google_maps_uri: string | null
  fetched_at: string
  status: LeadStatus
  follow_up_at: string | null
  saved_at: string
  deleted_at: string | null
  current_score: number | null
  last_audited_at: string | null
  enrichment_state: EnrichmentState | null
  enrichment_error: string | null
  website_status: WebsiteStatus | null
  dns_resolves: boolean | null
  is_https: boolean | null
  tls_valid: boolean | null
  is_mobile_friendly: boolean | null
  has_title: boolean | null
  has_meta_description: boolean | null
  has_favicon: boolean | null
  is_table_layout: boolean | null
  load_ms: number | null
  copyright_year: number | null
  platform: string | null
  platform_version: string | null
  presence_kind: string | null
  psi_state: PsiState | null
  psi_performance: number | null
  psi_lcp_ms: number | null
  psi_cls: number | string | null
  audit_flags: string[] | null
  list_ids: string[] | null
  note_count: number | null
}

/*
 * One unbroken literal, for the same reason the search repository keeps one:
 * supabase-js infers the row shape from the literal type of this string, and
 * splitting it across lines to be tidy collapses that inference to `string`.
 */
const LIBRARY_COLUMNS =
  'id, google_place_id, name, formatted_address, city, phone, website, rating, user_rating_count, primary_type, google_maps_uri, fetched_at, status, follow_up_at, saved_at, deleted_at, current_score, last_audited_at, enrichment_state, enrichment_error, website_status, dns_resolves, is_https, tls_valid, is_mobile_friendly, has_title, has_meta_description, has_favicon, is_table_layout, load_ms, copyright_year, platform, platform_version, presence_kind, psi_state, psi_performance, psi_lcp_ms, psi_cls, audit_flags, list_ids, note_count'

function toRow(record: LibraryRecord, listNames: Map<string, string>): LeadRow {
  return {
    id: record.id,
    googlePlaceId: record.google_place_id,
    name: record.name,
    city: record.city,
    formattedAddress: record.formatted_address,
    phone: record.phone,
    website: record.website,
    primaryType: record.primary_type,
    // numeric(2,1) arrives as a string from PostgREST; the table needs a number.
    rating: record.rating === null ? null : Number(record.rating),
    userRatingCount: record.user_rating_count,
    mapsUri: record.google_maps_uri,
    fetchedAt: record.fetched_at,
    status: record.status,
    score: record.current_score,
    followUpAt: record.follow_up_at,
    savedAt: record.saved_at,
    deletedAt: record.deleted_at,
    lastAuditedAt: record.last_audited_at,
    websiteStatus: record.website_status,
    enrichmentState: record.enrichment_state,
    enrichmentError: record.enrichment_error,
    dnsResolves: record.dns_resolves,
    isHttps: record.is_https,
    tlsValid: record.tls_valid,
    isMobileFriendly: record.is_mobile_friendly,
    hasTitle: record.has_title,
    hasMetaDescription: record.has_meta_description,
    hasFavicon: record.has_favicon,
    isTableLayout: record.is_table_layout,
    loadMs: record.load_ms,
    copyrightYear: record.copyright_year,
    platform: record.platform,
    platformVersion: record.platform_version,
    presenceKind: record.presence_kind,
    psiState: record.psi_state,
    psiPerformance: record.psi_performance,
    psiLcpMs: record.psi_lcp_ms,
    // numeric(5,3) arrives as a string from PostgREST, like rating above.
    psiCls: record.psi_cls === null ? null : Number(record.psi_cls),
    auditFlags: record.audit_flags ?? [],
    lists: (record.list_ids ?? [])
      .map((id) => ({ id, name: listNames.get(id) ?? 'Unknown list' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    noteCount: record.note_count ?? 0,
  }
}

/** `2026-07-30`, in the operator's own day rather than UTC's. */
function today(offsetDays = 0): string {
  const now = new Date()
  now.setDate(now.getDate() + offsetDays)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const SORT_COLUMNS: Record<LeadFilters['sort'], string> = {
  score: 'current_score',
  saved: 'saved_at',
  name: 'name',
  city: 'city',
  status: 'status',
  follow_up: 'follow_up_at',
  audited: 'last_audited_at',
}

/* ------------------------------------------------------------------------- *
 * Reading the library
 * ------------------------------------------------------------------------- */

/**
 * The narrowing methods, and no more.
 *
 * Declared structurally rather than through PostgREST's own builder generics:
 * constraining a type parameter to those makes the checker recurse until it
 * gives up (TS2589). The builder is cast to this once, inside the function
 * below, so the two call sites stay fully typed either side of it.
 */
interface Filterable {
  is(column: string, value: null): Filterable
  not(column: string, operator: string, value: null): Filterable
  ilike(column: string, pattern: string): Filterable
  in(column: string, values: readonly string[]): Filterable
  overlaps(column: string, values: readonly string[]): Filterable
  eq(column: string, value: unknown): Filterable
  gt(column: string, value: unknown): Filterable
  gte(column: string, value: unknown): Filterable
  lt(column: string, value: unknown): Filterable
  lte(column: string, value: unknown): Filterable
  or(filters: string): Filterable
}

/**
 * Narrow a query by the filter set.
 *
 * Shared by the listing and by "select all matching", which is the point: the
 * ids a bulk action touches are resolved by the same predicates that drew the
 * page. Two implementations would eventually disagree, and the day they did,
 * a delete would hit rows the operator was never shown.
 */
function applyFilters<T>(query: T, filters: LeadFilters): T {
  const builder = query as Filterable

  // The bin and the library are the same surface under one predicate.
  let result = filters.deleted
    ? builder.not('deleted_at', 'is', null)
    : builder.is('deleted_at', null)

  if (filters.q) {
    // Trigram-backed. `%` and `_` are wildcards to ILIKE, so a name containing
    // one would silently widen the search; escape before interpolating.
    const escaped = filters.q.replace(/[\\%_]/g, (match) => `\\${match}`)
    result = result.ilike('name', `%${escaped}%`)
  }
  if (filters.status.length) result = result.in('status', filters.status)
  if (filters.cities.length) result = result.in('city', filters.cities)
  if (filters.categories.length) result = result.in('primary_type', filters.categories)
  if (filters.listIds.length) result = result.overlaps('list_ids', filters.listIds)
  if (filters.scoreMin !== null) result = result.gte('current_score', filters.scoreMin)
  if (filters.scoreMax !== null) result = result.lte('current_score', filters.scoreMax)

  /*
   * The audit filters, in one predicate.
   *
   * Several selected at once are OR'd, not AND'd: "no HTTPS, not mobile" means
   * show me leads with either fault. Anding them would describe a single site
   * carrying every fault at once, which returns nothing and teaches the
   * operator to stop using the filter.
   *
   * An overlap against `audit_flags` IS that OR, which is the whole reason the
   * view synthesises that column — including the one flag that is not a
   * finding, `never_audited`. The alternative was OR-ing an array predicate
   * against a null check inside a hand-built PostgREST filter string, and this
   * has one thing that cannot be got wrong instead of two that can.
   */
  if (filters.audit.length) result = result.overlaps('audit_flags', filters.audit)

  switch (filters.followUp) {
    case 'overdue':
      result = result.lt('follow_up_at', today())
      break
    case 'today':
      result = result.eq('follow_up_at', today())
      break
    case 'week':
      result = result.gte('follow_up_at', today()).lte('follow_up_at', today(7))
      break
    case 'scheduled':
      result = result.not('follow_up_at', 'is', null)
      break
    case 'none':
      result = result.is('follow_up_at', null)
      break
    default:
      break
  }

  return result as T
}

export async function queryLeads(filters: LeadFilters): Promise<LeadListing> {
  const supabase = createServiceClient()

  const filtered = applyFilters(
    supabase.from('leads_library').select(LIBRARY_COLUMNS, { count: 'exact' }),
    filters,
  )

  const column = SORT_COLUMNS[filters.sort] ?? SORT_COLUMNS.score
  const from = (filters.page - 1) * PAGE_SIZE
  const query = filtered
    // An unscored or undated lead is unknown, not last. It sinks either way,
    // which keeps "no score yet" from reading as "scored zero".
    .order(column, { ascending: !filters.desc, nullsFirst: false })
    // Ties would otherwise come back in whatever order the heap felt like,
    // which makes pagination drop and duplicate rows between pages.
    .order('saved_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)

  const [{ data, error, count }, listNames, libraryTotal] = await Promise.all([
    query,
    readListNames(),
    countLibrary(),
  ])

  if (error) throw new Error(`Could not read the library: ${error.message}`)

  return {
    rows: ((data ?? []) as unknown as LibraryRecord[]).map((record) => toRow(record, listNames)),
    total: count ?? 0,
    libraryTotal,
    page: filters.page,
    pageSize: PAGE_SIZE,
  }
}

/**
 * Every id matching the filters, ignoring pagination.
 *
 * What "select all filtered" actually selects. Returned as ids rather than rows
 * because the only thing done with them is a bulk action, and shipping 4000
 * full rows to the browser to check 4000 boxes would be absurd.
 */
export async function queryLeadIds(filters: LeadFilters, limit = 5000): Promise<string[]> {
  const supabase = createServiceClient()

  // One query selecting one column, not the paged listing. Reading four
  // thousand full rows — audits, list arrays, note counts — to throw away
  // everything but the id would be forty round trips for a delete.
  const { data, error } = await applyFilters(
    supabase.from('leads_library').select('id'),
    filters,
  ).range(0, limit - 1)

  if (error) throw new Error(`Could not resolve the selection: ${error.message}`)
  return ((data ?? []) as { id: string }[]).map((row) => row.id)
}

async function readListNames(): Promise<Map<string, string>> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('lists').select('id, name')
  return new Map((data ?? []).map((list) => [list.id, list.name]))
}

async function countLibrary(): Promise<number> {
  const supabase = createServiceClient()
  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
  return count ?? 0
}

/**
 * The values actually present in the library, with counts.
 *
 * Offering every German city as a filter option would be useless; offering the
 * eleven the operator has actually saved from is the whole point. Counts come
 * along because "Heilbronn 214" tells him where his book is concentrated.
 */
export async function readFacets(): Promise<LeadFacets> {
  const supabase = createServiceClient()

  const [places, listRows, memberships, deleted] = await Promise.all([
    supabase
      .from('leads')
      .select('id, city, primary_type, status')
      .is('deleted_at', null)
      .limit(20000),
    supabase.from('lists').select('id, name').order('name'),
    supabase.from('lead_lists').select('list_id, lead_id').limit(20000),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .not('deleted_at', 'is', null),
  ])

  const cities = new Map<string, number>()
  const categories = new Map<string, number>()
  const statuses = new Map<LeadStatus, number>()
  const live = new Set<string>()

  for (const place of (places.data ?? []) as {
    id: string
    city: string | null
    primary_type: string | null
    status: LeadStatus
  }[]) {
    live.add(place.id)
    if (place.city) cities.set(place.city, (cities.get(place.city) ?? 0) + 1)
    if (place.primary_type) {
      categories.set(place.primary_type, (categories.get(place.primary_type) ?? 0) + 1)
    }
    statuses.set(place.status, (statuses.get(place.status) ?? 0) + 1)
  }

  // Counted against the live set rather than through an embedded join: a list
  // holding forty deleted leads must not advertise forty.
  const listCounts = new Map<string, number>()
  for (const row of (memberships.data ?? []) as { list_id: string; lead_id: string }[]) {
    if (!live.has(row.lead_id)) continue
    listCounts.set(row.list_id, (listCounts.get(row.list_id) ?? 0) + 1)
  }

  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count

  return {
    cities: [...cities].map(([value, count]) => ({ value, count })).sort(byCount),
    categories: [...categories].map(([value, count]) => ({ value, count })).sort(byCount),
    lists: ((listRows.data ?? []) as { id: string; name: string }[]).map((list) => ({
      id: list.id,
      name: list.name,
      count: listCounts.get(list.id) ?? 0,
    })),
    statuses: [...statuses].map(([value, count]) => ({ value, count })).sort(byCount),
    deletedCount: deleted.count ?? 0,
  }
}

/* ------------------------------------------------------------------------- *
 * Lists
 * ------------------------------------------------------------------------- */

export async function readLists(): Promise<{ id: string; name: string }[]> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('lists').select('id, name').order('name')
  return (data ?? []) as { id: string; name: string }[]
}

/**
 * Find or create, case-insensitively.
 *
 * "Neuss" typed twice must not become two lists, and the unique index on
 * lower(name) means the second insert would fail rather than silently
 * duplicate. Reading first turns that failure into the intended outcome.
 */
export async function ensureList(name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A list needs a name.')

  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('lists')
    .select('id, name')
    .ilike('name', trimmed)
    .maybeSingle()

  if (existing) return existing as { id: string; name: string }

  const { data, error } = await supabase
    .from('lists')
    .insert({ name: trimmed })
    .select('id, name')
    .single()

  if (error) {
    // Lost a race against another tab. The row now exists; use it.
    const { data: raced } = await supabase
      .from('lists')
      .select('id, name')
      .ilike('name', trimmed)
      .maybeSingle()
    if (raced) return raced as { id: string; name: string }
    throw new Error(`Could not create the list: ${error.message}`)
  }

  return data as { id: string; name: string }
}

/* ------------------------------------------------------------------------- *
 * Saving — the one path that creates a lead
 * ------------------------------------------------------------------------- */

function snapshotFrom(candidate: SaveRequest['candidates'][number]) {
  return {
    name: candidate.name,
    formatted_address: candidate.formattedAddress ?? null,
    city: cityFrom(candidate.formattedAddress),
    lat: candidate.lat ?? null,
    lng: candidate.lng ?? null,
    phone: candidate.phone ?? null,
    website: candidate.website ?? null,
    rating: candidate.rating ?? null,
    user_rating_count: candidate.userRatingCount ?? null,
    business_status: candidate.businessStatus ?? null,
    primary_type: candidate.primaryType ?? null,
    types: candidate.types ?? [],
    google_maps_uri: candidate.mapsUri ?? null,
    place_snapshot: candidate.raw ?? null,
    // The age of the Google data, carried from the search that found it rather
    // than reset to now(). A lead saved from a week-old replay is a week old.
    fetched_at: candidate.fetchedAt ?? new Date().toISOString(),
  }
}

/**
 * The city, pulled out of the formatted address for grouping.
 *
 * Google returns `Straße 1, 74072 Heilbronn, Germany` — the city is the
 * second-to-last part, minus a postal code. Deliberately crude: this feeds a
 * filter dropdown, and a wrong guess costs one odd entry in a list, not a
 * wrong record. `addressComponents` would be exact but is a billed field.
 */
function cityFrom(address: string | null | undefined): string | null {
  if (!address) return null
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const candidate = parts[parts.length - 2]
  const withoutPostcode = candidate.replace(/^\d{4,6}\s+/, '').trim()
  return withoutPostcode || null
}

export async function saveLeads(request: SaveRequest): Promise<SaveResult> {
  const supabase = createServiceClient()

  // Deduplicate the selection itself: the same business can appear twice across
  // two pages of results, and saving it twice is not two leads.
  const candidates = [...new Map(request.candidates.map((c) => [c.googlePlaceId, c])).values()]
  if (!candidates.length) {
    return { items: [], saved: 0, updated: 0, restored: 0, failed: 0, list: null, enrichmentQueued: 0 }
  }

  const placeIds = candidates.map((candidate) => candidate.googlePlaceId)
  const { data: existingRows } = await supabase
    .from('leads')
    .select('id, google_place_id, deleted_at')
    .in('google_place_id', placeIds)

  const existing = new Map(
    ((existingRows ?? []) as { id: string; google_place_id: string; deleted_at: string | null }[])
      .map((row) => [row.google_place_id, row]),
  )

  const items: SaveResultItem[] = []
  const savedIds: string[] = []

  /*
   * Insert and update are separate statements rather than one upsert, and this
   * is the load-bearing decision in the whole function.
   *
   * An upsert would overwrite every column it was given, which means re-saving
   * a business the operator already worked would reset its status to `new` and
   * its saved_at to today — silently destroying exactly the work product this
   * table exists to protect. So: new rows get the owner columns, existing rows
   * get only the Google snapshot refreshed.
   */
  const toInsert = candidates.filter((candidate) => !existing.has(candidate.googlePlaceId))
  const toUpdate = candidates.filter((candidate) => existing.has(candidate.googlePlaceId))

  if (toInsert.length) {
    const payload = toInsert.map((candidate) => ({
      google_place_id: candidate.googlePlaceId,
      ...snapshotFrom(candidate),
      status: 'new' as const,
      discovered_via_search_id: request.searchId ?? null,
      enrichment_state: 'queued' as const,
      enrichment_queued_at: new Date().toISOString(),
    }))

    const { data, error } = await supabase.from('leads').insert(payload).select('id, google_place_id')

    if (error) {
      // A batch insert fails whole. Retrying one at a time is what turns
      // "nothing saved, here is a Postgres error" into a per-business answer.
      for (const candidate of toInsert) {
        const single = await supabase
          .from('leads')
          .insert({
            google_place_id: candidate.googlePlaceId,
            ...snapshotFrom(candidate),
            status: 'new' as const,
            discovered_via_search_id: request.searchId ?? null,
            enrichment_state: 'queued' as const,
            enrichment_queued_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (single.error || !single.data) {
          items.push({
            googlePlaceId: candidate.googlePlaceId,
            name: candidate.name,
            outcome: 'failed',
            leadId: null,
            error: single.error?.message ?? 'The insert returned no row.',
          })
        } else {
          items.push({
            googlePlaceId: candidate.googlePlaceId,
            name: candidate.name,
            outcome: 'saved',
            leadId: single.data.id,
          })
          savedIds.push(single.data.id)
        }
      }
    } else {
      const byPlace = new Map(
        ((data ?? []) as { id: string; google_place_id: string }[]).map((row) => [
          row.google_place_id,
          row.id,
        ]),
      )
      for (const candidate of toInsert) {
        const id = byPlace.get(candidate.googlePlaceId) ?? null
        items.push({
          googlePlaceId: candidate.googlePlaceId,
          name: candidate.name,
          outcome: 'saved',
          leadId: id,
        })
        if (id) savedIds.push(id)
      }
    }
  }

  for (const candidate of toUpdate) {
    const row = existing.get(candidate.googlePlaceId)!
    const wasDeleted = Boolean(row.deleted_at)

    const { error } = await supabase
      .from('leads')
      .update({
        ...snapshotFrom(candidate),
        // Re-saving a deleted lead is how you undo a delete without knowing
        // the word undo. Its notes, status and history come back with it.
        deleted_at: null,
      })
      .eq('id', row.id)

    if (error) {
      items.push({
        googlePlaceId: candidate.googlePlaceId,
        name: candidate.name,
        outcome: 'failed',
        leadId: row.id,
        error: error.message,
      })
      continue
    }

    items.push({
      googlePlaceId: candidate.googlePlaceId,
      name: candidate.name,
      outcome: wasDeleted ? 'restored' : 'updated',
      leadId: row.id,
    })
    savedIds.push(row.id)
  }

  /*
   * The list and the note are applied after the leads exist, and their failure
   * does not fail the save. Losing a tag is an annoyance; losing the six
   * businesses the operator just picked out of sixty is the session.
   */
  let list: { id: string; name: string } | null = null
  if (savedIds.length) {
    try {
      if (request.listId) {
        const found = (await readLists()).find((entry) => entry.id === request.listId)
        if (found) list = found
      } else if (request.newListName?.trim()) {
        list = await ensureList(request.newListName)
      }

      if (list) {
        await supabase.from('lead_lists').upsert(
          savedIds.map((leadId) => ({ list_id: list!.id, lead_id: leadId })),
          { onConflict: 'list_id,lead_id', ignoreDuplicates: true },
        )
      }
    } catch (error) {
      console.error('[leads] could not file the selection under a list', error)
    }

    const note = request.note?.trim()
    if (note) {
      const { error } = await supabase
        .from('lead_notes')
        .insert(savedIds.map((leadId) => ({ lead_id: leadId, body: note })))
      if (error) console.error('[leads] could not attach the note', error.message)
    }
  }

  // Re-saved leads are re-queued too: the operator is looking at this business
  // again, so the audit under it should be current rather than months old.
  const enrichmentQueued = await queueEnrichment(savedIds)

  return {
    items,
    saved: items.filter((item) => item.outcome === 'saved').length,
    updated: items.filter((item) => item.outcome === 'updated').length,
    restored: items.filter((item) => item.outcome === 'restored').length,
    failed: items.filter((item) => item.outcome === 'failed').length,
    list,
    enrichmentQueued,
  }
}

/** Mark leads for the background pass. Returns how many are now waiting. */
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
    console.error('[leads] could not queue enrichment', error.message)
    return 0
  }
  return data?.length ?? 0
}

/* ------------------------------------------------------------------------- *
 * Bulk actions
 * ------------------------------------------------------------------------- */

export async function applyBulk(leadIds: string[], action: BulkAction): Promise<BulkResult> {
  if (!leadIds.length) return { affected: 0, message: 'Nothing was selected.' }

  const supabase = createServiceClient()
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

  switch (action.action) {
    case 'status': {
      const { data, error } = await supabase
        .from('leads')
        .update({ status: action.status })
        .in('id', leadIds)
        .select('id')
      if (error) throw new Error(`Could not change status: ${error.message}`)
      const affected = data?.length ?? 0
      return {
        affected,
        message: `${affected} ${plural(affected, 'lead', 'leads')} set to ${action.status}.`,
      }
    }

    case 'add_to_list': {
      const list = action.listId
        ? (await readLists()).find((entry) => entry.id === action.listId)
        : action.newListName
          ? await ensureList(action.newListName)
          : null
      if (!list) throw new Error('Pick a list, or name a new one.')

      const { error } = await supabase.from('lead_lists').upsert(
        leadIds.map((leadId) => ({ list_id: list.id, lead_id: leadId })),
        { onConflict: 'list_id,lead_id', ignoreDuplicates: true },
      )
      if (error) throw new Error(`Could not add to the list: ${error.message}`)
      return {
        affected: leadIds.length,
        message: `${leadIds.length} ${plural(leadIds.length, 'lead', 'leads')} added to ${list.name}.`,
      }
    }

    case 'remove_from_list': {
      const { error } = await supabase
        .from('lead_lists')
        .delete()
        .eq('list_id', action.listId)
        .in('lead_id', leadIds)
      if (error) throw new Error(`Could not remove from the list: ${error.message}`)
      return { affected: leadIds.length, message: `Removed from the list.` }
    }

    case 'follow_up': {
      const { data, error } = await supabase
        .from('leads')
        .update({ follow_up_at: action.followUpAt })
        .in('id', leadIds)
        .select('id')
      if (error) throw new Error(`Could not set the follow-up date: ${error.message}`)
      const affected = data?.length ?? 0
      return {
        affected,
        message: action.followUpAt
          ? `Follow-up set for ${affected} ${plural(affected, 'lead', 'leads')}.`
          : `Follow-up cleared on ${affected} ${plural(affected, 'lead', 'leads')}.`,
      }
    }

    case 'delete': {
      /*
       * Soft, always. The row keeps its audits, its notes and its outreach log,
       * and only stops being listed. `undoIds` goes back to the client so the
       * undo control puts back exactly this set — not "everything deleted in
       * the last minute", which would swallow a deliberate earlier delete.
       */
      const { data, error } = await supabase
        .from('leads')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', leadIds)
        .is('deleted_at', null)
        .select('id')
      if (error) throw new Error(`Could not delete: ${error.message}`)

      const undoIds = ((data ?? []) as { id: string }[]).map((row) => row.id)
      return {
        affected: undoIds.length,
        undoIds,
        message: `${undoIds.length} ${plural(undoIds.length, 'lead', 'leads')} deleted.`,
      }
    }

    case 'restore': {
      const { data, error } = await supabase
        .from('leads')
        .update({ deleted_at: null })
        .in('id', leadIds)
        .not('deleted_at', 'is', null)
        .select('id')
      if (error) throw new Error(`Could not restore: ${error.message}`)
      const affected = data?.length ?? 0
      return {
        affected,
        message: `${affected} ${plural(affected, 'lead', 'leads')} restored.`,
      }
    }

    case 're_audit': {
      const affected = await queueEnrichment(leadIds)
      return {
        affected,
        message: `${affected} ${plural(affected, 'lead', 'leads')} queued for re-audit.`,
      }
    }

    default:
      throw new Error('Unknown action.')
  }
}

/* ------------------------------------------------------------------------- *
 * One lead
 * ------------------------------------------------------------------------- */

export async function readLead(id: string): Promise<LeadRow | null> {
  const supabase = createServiceClient()
  const [{ data }, listNames] = await Promise.all([
    supabase.from('leads_library').select(LIBRARY_COLUMNS).eq('id', id).maybeSingle(),
    readListNames(),
  ])
  if (!data) return null
  return toRow(data as unknown as LibraryRecord, listNames)
}

/*
 * One unbroken literal, for the same reason LIBRARY_COLUMNS is one.
 */
const AUDIT_COLUMNS =
  'id, audited_at, checker_version, website_url, final_url, website_status, http_status, duration_ms, error, dns_resolves, is_https, tls_valid, tls_expires_at, is_mobile_friendly, has_title, has_meta_description, has_favicon, is_table_layout, load_ms, copyright_year, platform, platform_version, presence_kind, psi_state, psi_performance, psi_lcp_ms, psi_cls, psi_error, psi_checked_at, failed_codes'

interface AuditRecord {
  id: string
  audited_at: string
  checker_version: string
  website_url: string | null
  final_url: string | null
  website_status: WebsiteStatus
  http_status: number | null
  duration_ms: number | null
  error: string | null
  dns_resolves: boolean | null
  is_https: boolean | null
  tls_valid: boolean | null
  tls_expires_at: string | null
  is_mobile_friendly: boolean | null
  has_title: boolean | null
  has_meta_description: boolean | null
  has_favicon: boolean | null
  is_table_layout: boolean | null
  load_ms: number | null
  copyright_year: number | null
  platform: string | null
  platform_version: string | null
  presence_kind: string | null
  psi_state: PsiState
  psi_performance: number | null
  psi_lcp_ms: number | null
  psi_cls: number | string | null
  psi_error: string | null
  psi_checked_at: string | null
  failed_codes: string[] | null
}

function toAudit(record: AuditRecord, findings: AuditFinding[]): LeadAudit {
  return {
    id: record.id,
    auditedAt: record.audited_at,
    checkerVersion: record.checker_version,
    websiteUrl: record.website_url,
    finalUrl: record.final_url,
    websiteStatus: record.website_status,
    httpStatus: record.http_status,
    durationMs: record.duration_ms,
    error: record.error,
    dnsResolves: record.dns_resolves,
    isHttps: record.is_https,
    tlsValid: record.tls_valid,
    tlsExpiresAt: record.tls_expires_at,
    isMobileFriendly: record.is_mobile_friendly,
    hasTitle: record.has_title,
    hasMetaDescription: record.has_meta_description,
    hasFavicon: record.has_favicon,
    isTableLayout: record.is_table_layout,
    loadMs: record.load_ms,
    copyrightYear: record.copyright_year,
    platform: record.platform,
    platformVersion: record.platform_version,
    presenceKind: record.presence_kind,
    psiState: record.psi_state,
    psiPerformance: record.psi_performance,
    psiLcpMs: record.psi_lcp_ms,
    psiCls: record.psi_cls === null ? null : Number(record.psi_cls),
    psiError: record.psi_error,
    psiCheckedAt: record.psi_checked_at,
    findings,
  }
}

/**
 * One lead, with its diagnosis and everything before it.
 *
 * The newest audit comes back in full — every measurement, every judgement,
 * every piece of evidence — because that is what the operator reads aloud on a
 * call. The rest come back as one line each, which is all history is for: it
 * answers "has anything changed since I last looked", not "what exactly did the
 * page say in March".
 */
export async function readLeadDetail(id: string): Promise<LeadDetail | null> {
  const supabase = createServiceClient()

  const lead = await readLead(id)
  if (!lead) return null

  const { data: audits } = await supabase
    .from('lead_audits')
    .select(AUDIT_COLUMNS)
    .eq('lead_id', id)
    .order('audited_at', { ascending: false })
    .limit(25)

  const records = (audits ?? []) as unknown as AuditRecord[]
  const newest = records[0] ?? null

  if (!newest) return { lead, audit: null, history: [] }

  const { data: findingRows } = await supabase
    .from('lead_audit_findings')
    .select('code, category, severity, passed, value, message')
    .eq('audit_id', newest.id)

  const findings = ((findingRows ?? []) as {
    code: string
    category: string | null
    severity: FindingSeverity
    passed: boolean
    value: Record<string, unknown> | null
    message: string | null
  }[]).map((row) => ({
    code: row.code,
    category: row.category ?? 'other',
    severity: row.severity,
    passed: row.passed,
    value: row.value,
    message: row.message ?? '',
  }))

  /*
   * Past audits are summarised from the codes already folded onto them, not
   * from their findings. Fetching the full diagnosis for twenty-five historical
   * audits in order to render twenty-five one-line summaries would be most of a
   * megabyte spent on a column of dates — which is exactly what `failed_codes`
   * on the audit row is for.
   */
  const history: AuditSummary[] = records.slice(1).map((record) => ({
    id: record.id,
    auditedAt: record.audited_at,
    websiteStatus: record.website_status,
    checkerVersion: record.checker_version,
    failedCodes: record.failed_codes ?? [],
    psiPerformance: record.psi_performance,
  }))

  return { lead, audit: toAudit(newest, findings), history }
}

export async function updateLead(
  id: string,
  patch: { status?: LeadStatus; followUpAt?: string | null },
): Promise<void> {
  const supabase = createServiceClient()
  const payload: Record<string, unknown> = {}
  if (patch.status) payload.status = patch.status
  if (patch.followUpAt !== undefined) payload.follow_up_at = patch.followUpAt
  if (!Object.keys(payload).length) return

  const { error } = await supabase.from('leads').update(payload).eq('id', id)
  if (error) throw new Error(`Could not update the lead: ${error.message}`)
}

export async function addNote(leadId: string, body: string): Promise<void> {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('A note needs something in it.')

  const supabase = createServiceClient()
  const { error } = await supabase.from('lead_notes').insert({ lead_id: leadId, body: trimmed })
  if (error) throw new Error(`Could not save the note: ${error.message}`)
}
