import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import { isChangeCode } from '@/lib/leads/changes'
import { today } from '@/lib/leads/dates'
import { coldFilters, dueFilters } from '@/lib/leads/filters'
import { describeDelta, type Snapshot } from '@/lib/refresh/diff'
import {
  LIMITS,
  PAGE_SIZE,
  type ActivityType,
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
  type OutreachQueues,
  type PsiState,
  type SaveRequest,
  type SaveResult,
  type SaveResultItem,
  type TimelineEntry,
  type WebsiteStatus,
} from '@/lib/leads/types'
import { queueEnrichment } from '@/lib/enrichment/store'
import type { FindingSeverity } from '@/lib/enrichment/vocabulary'
import { runRefresh } from '@/lib/refresh/run'
import { compareScores } from '@/lib/scoring/score'
import { readCurrentScore, readPreviousScore } from '@/lib/scoring/store'

/*
 * Everything the permanent side reads and writes.
 *
 * The counterpart to lib/search/repository.ts, and the only module allowed to
 * create a lead. That asymmetry is the product's central rule expressed in
 * code: discovery may only ever *read* `leads`, and a row appears here because
 * saveLeads() was called by a route the operator deliberately hit.
 */

/**
 * The enrichment queue's door, re-exported.
 *
 * It lives in lib/enrichment/store.ts — saving, the bulk re-audit and the
 * refresh pass all need it, and having the refresh pass reach into this module
 * for it made the two import each other. Kept exported here so the routes that
 * already speak to this module did not have to learn a second one.
 */
export { queueEnrichment }

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
  imprint_email: string | null
  imprint_phone: string | null
  imprint_fetched_at: string | null
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
  change_flags: string[] | null
  changed_at: string | null
  refresh_error: string | null
  list_ids: string[] | null
  note_count: number | null
}

/*
 * One unbroken literal, for the same reason the search repository keeps one:
 * supabase-js infers the row shape from the literal type of this string, and
 * splitting it across lines to be tidy collapses that inference to `string`.
 */
const LIBRARY_COLUMNS =
  'id, google_place_id, name, formatted_address, city, phone, website, rating, user_rating_count, primary_type, google_maps_uri, fetched_at, imprint_email, imprint_phone, imprint_fetched_at, status, follow_up_at, saved_at, deleted_at, current_score, last_audited_at, enrichment_state, enrichment_error, website_status, dns_resolves, is_https, tls_valid, is_mobile_friendly, has_title, has_meta_description, has_favicon, is_table_layout, load_ms, copyright_year, platform, platform_version, presence_kind, psi_state, psi_performance, psi_lcp_ms, psi_cls, audit_flags, change_flags, changed_at, refresh_error, list_ids, note_count'

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
    imprintEmail: record.imprint_email,
    imprintPhone: record.imprint_phone,
    imprintFetchedAt: record.imprint_fetched_at,
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
    changeFlags: record.change_flags ?? [],
    changedAt: record.changed_at,
    refreshError: record.refresh_error,
    lists: (record.list_ids ?? [])
      .map((id) => ({ id, name: listNames.get(id) ?? 'Unknown list' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    noteCount: record.note_count ?? 0,
  }
}

const SORT_COLUMNS: Record<LeadFilters['sort'], string> = {
  score: 'current_score',
  saved: 'saved_at',
  name: 'name',
  city: 'city',
  status: 'status',
  follow_up: 'follow_up_at',
  audited: 'last_audited_at',
  changed: 'changed_at',
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

  /*
   * The change filters, in the same one predicate and OR'd for the same reason.
   * "Built a site, or their number changed" is a question; a site that did both
   * at once is not.
   */
  if (filters.change.length) result = result.overlaps('change_flags', filters.change)

  /*
   * The writable list. Not an audit filter — an email address is a fact about
   * the business rather than a fault on its site — and it is the one question
   * asked before a session of writing rather than calling.
   */
  if (filters.hasEmail) result = result.not('imprint_email', 'is', null)

  switch (filters.followUp) {
    // A date that has arrived, whether this morning or a fortnight ago. Null
    // dates are excluded by the comparison itself, not by a second predicate.
    case 'now':
      result = result.lte('follow_up_at', today())
      break
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
 * The whole filtered set, a page at a time.
 *
 * What the CSV export reads. A generator rather than an array for the reason
 * the provider's search is a generator: the caller writes each page to the
 * response as it arrives, so a four-thousand-row export never has four thousand
 * rows in memory at once and the browser starts receiving the file immediately.
 *
 * Ordered by the same sort the page was drawn with, and by `id` last, which is
 * what stops `range()` dropping and repeating rows between pages. `EXPORT_LIMIT`
 * is a stated ceiling rather than a silent one — the route says so in the file
 * when it bites.
 */
export const EXPORT_LIMIT = 20_000

export async function* leadPages(
  filters: LeadFilters,
  pageSize = 500,
  limit = EXPORT_LIMIT,
): AsyncGenerator<LeadRow[], void, void> {
  const supabase = createServiceClient()
  const listNames = await readListNames()
  const column = SORT_COLUMNS[filters.sort] ?? SORT_COLUMNS.score

  for (let offset = 0; offset < limit; offset += pageSize) {
    const size = Math.min(pageSize, limit - offset)

    const { data, error } = await applyFilters(
      supabase.from('leads_library').select(LIBRARY_COLUMNS),
      filters,
    )
      .order(column, { ascending: !filters.desc, nullsFirst: false })
      .order('saved_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + size - 1)

    if (error) throw new Error(`Could not read the library: ${error.message}`)

    const rows = ((data ?? []) as unknown as LibraryRecord[]).map((record) =>
      toRow(record, listNames),
    )
    if (!rows.length) return

    yield rows
    if (rows.length < size) return
  }
}

/**
 * Every id matching the filters, ignoring pagination.
 *
 * What "select all filtered" actually selects. Returned as ids rather than rows
 * because the only thing done with them is a bulk action, and shipping 4000
 * full rows to the browser to check 4000 boxes would be absurd.
 */
export const SELECT_ALL_LIMIT = 5000

export async function queryLeadIds(
  filters: LeadFilters,
  limit = SELECT_ALL_LIMIT,
): Promise<{ ids: string[]; truncated: boolean }> {
  const supabase = createServiceClient()

  // One query selecting one column, not the paged listing. Reading four
  // thousand full rows — audits, list arrays, note counts — to throw away
  // everything but the id would be forty round trips for a delete.
  //
  // One row past the limit is asked for, purely to find out whether there was
  // one. A cap on a set that a DELETE is about to be applied to has to be
  // detectable, not just applied.
  const { data, error } = await applyFilters(
    supabase.from('leads_library').select('id'),
    filters,
  ).range(0, limit)

  if (error) throw new Error(`Could not resolve the selection: ${error.message}`)

  const rows = ((data ?? []) as { id: string }[]).map((row) => row.id)
  return { ids: rows.slice(0, limit), truncated: rows.length > limit }
}

/**
 * The Outreach surface, in one read.
 *
 * Two questions against the same library rather than a queue table of their
 * own. Nothing is materialised, so a lead leaves a queue the moment the
 * operator acts on it — setting a status or a new date is the only thing that
 * has to happen, and the next read simply does not find it.
 */
export async function readOutreach(): Promise<OutreachQueues> {
  const [due, cold] = await Promise.all([
    queryLeads(dueFilters()),
    queryLeads(coldFilters()),
  ])
  return { due, cold }
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

  /*
   * Four reads, each returning about as many rows as the menu will draw.
   *
   * This used to fetch the whole library and group it here — twenty thousand
   * lead rows and twenty thousand list memberships, over the wire, on every
   * filter change, to render thirty menu entries. Every filter change in this
   * surface is a navigation, so that was the cost of a click on the page the
   * operator lives on, and past the fetch limit the counts quietly stopped
   * being true with nothing saying so.
   *
   * The GROUP BY belongs where the rows are. See the facets migration.
   */
  const [values, statusRows, listRows, deleted] = await Promise.all([
    supabase.from('lead_facet_values').select('kind, value, count'),
    supabase.from('lead_status_counts').select('status, count'),
    supabase.from('lead_list_counts').select('id, name, count').order('name'),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .not('deleted_at', 'is', null),
  ])

  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count

  // `count(*)` is bigint, and PostgREST sends bigint as a string to avoid
  // losing precision in JSON. Every count below is therefore coerced.
  const rows = (values.data ?? []) as { kind: string; value: string; count: number | string }[]
  const of = (kind: string) =>
    rows
      .filter((row) => row.kind === kind)
      .map((row) => ({ value: row.value, count: Number(row.count) }))
      .sort(byCount)

  return {
    cities: of('city'),
    categories: of('category'),
    lists: ((listRows.data ?? []) as { id: string; name: string; count: number | string }[]).map(
      (list) => ({ id: list.id, name: list.name, count: Number(list.count) }),
    ),
    statuses: ((statusRows.data ?? []) as { status: LeadStatus; count: number | string }[])
      .map((row) => ({ value: row.status, count: Number(row.count) }))
      .sort(byCount),
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
  // Same ceiling a saved view's name has, and for the same reason: both are
  // read in a one-line bar, and the column is `text` so nothing else stops a
  // paste. Refused rather than silently truncated — a list he cannot find again
  // under the name he gave it is worse than an error he can act on.
  if (trimmed.length > LIMITS.name) {
    throw new Error(`That list name is too long (max ${LIMITS.name} characters).`)
  }

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

    /*
     * The one bulk action that spends money, so it is the one that runs in front
     * of the response instead of queueing.
     *
     * Every lead in the selection is a billable Place Details call, and the
     * operator is entitled to be told what it cost him and what it found before
     * the page moves. The pass stops itself at the monthly ceiling and says so.
     */
    case 'refresh': {
      const pass = await runRefresh({ leadIds, source: 'manual' })
      const said = [
        `${pass.refreshed} ${plural(pass.refreshed, 'lead', 'leads')} refreshed`,
        pass.changed ? `${pass.changed} changed` : null,
        pass.reAudited ? `${pass.reAudited} re-audited` : null,
        pass.failed ? `${pass.failed} could not be reached` : null,
      ].filter(Boolean)

      return {
        affected: pass.refreshed,
        message: pass.stoppedBy ? `${said.join(', ')}. ${pass.stoppedBy}` : `${said.join(', ')}.`,
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

/** One refresh row, as it comes back over the wire. */
interface RefreshRow {
  id: string
  refreshed_at: string
  changes: string[] | null
  before: Snapshot | null
  after: Snapshot | null
  error: string | null
}

/**
 * A refresh row as one sentence.
 *
 * Built here rather than stored, because it is a rendering of the codes and the
 * values beside them — and a rendering that lives in the database is one that
 * cannot be improved without a migration. A row written before the values were
 * captured, or by a build with a code this one does not know, comes back with
 * nothing to say rather than with a guess.
 */
function refreshSentence(row: RefreshRow): string | null {
  if (row.error) return `Google could not be reached. ${row.error}`
  if (!row.before || !row.after) return null

  const codes = (row.changes ?? []).filter(isChangeCode)
  if (!codes.length) return null

  return describeDelta({ codes, before: row.before, after: row.after })
}

/**
 * Everything that has happened to this lead, as one sequence.
 *
 * Three tables now, read separately and merged here rather than in SQL. A union
 * view would have to widen every side to a common column list and cast the enum
 * to text to do it, and the result would still need sorting in one place — this
 * way each table keeps its own shape and the merge is a few lines that can be
 * read.
 *
 * The third table is `lead_refreshes`, and it belongs here rather than in a
 * panel of its own for the reason the notes and the activities were merged in
 * the first place: the operator worked this lead once, in one order. "I called
 * them in May, they said they were thinking about it, and in July they built a
 * website" is one story, and splitting it across two lists on the same page
 * would make him assemble it himself every time he came back cold.
 *
 * Every side is limited before the merge, so a lead with three hundred notes
 * cannot push its status history off the end of the page: the limit costs the
 * oldest lines of each, which is what a limit on a history should cost.
 */
export async function readTimeline(leadId: string, limit = 200): Promise<TimelineEntry[]> {
  const supabase = createServiceClient()

  const [activities, notes, refreshes] = await Promise.all([
    supabase
      .from('lead_activities')
      .select('id, type, occurred_at, summary, status_before, status_after')
      .eq('lead_id', leadId)
      .order('occurred_at', { ascending: false })
      .limit(limit),
    supabase
      .from('lead_notes')
      .select('id, body, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('lead_refreshes')
      .select('id, refreshed_at, changes, before, after, error')
      .eq('lead_id', leadId)
      .order('refreshed_at', { ascending: false })
      .limit(limit),
  ])

  const entries: TimelineEntry[] = [
    ...((refreshes.data ?? []) as RefreshRow[]).map((row) => ({
      id: `refresh:${row.id}`,
      kind: 'refresh' as const,
      type: null,
      at: row.refreshed_at,
      body: refreshSentence(row),
      statusBefore: null,
      statusAfter: null,
      changes: row.changes ?? [],
    })),
    ...((activities.data ?? []) as {
      id: number
      type: ActivityType
      occurred_at: string
      summary: string | null
      status_before: LeadStatus | null
      status_after: LeadStatus | null
    }[]).map((row) => ({
      id: `activity:${row.id}`,
      kind: 'activity' as const,
      type: row.type,
      at: row.occurred_at,
      body: row.summary,
      statusBefore: row.status_before,
      statusAfter: row.status_after,
    })),
    ...((notes.data ?? []) as { id: string; body: string; created_at: string }[]).map((row) => ({
      id: `note:${row.id}`,
      kind: 'note' as const,
      type: null,
      at: row.created_at,
      body: row.body,
      statusBefore: null,
      statusAfter: null,
    })),
  ]

  /*
   * Newest first, and the id breaks the tie. A note saved alongside a status
   * change lands in the same transaction and can share a timestamp to the
   * microsecond; without a second key the two would swap places between reads
   * and the history would look like it was rewriting itself.
   */
  return entries
    .sort((a, b) => (a.at === b.at ? b.id.localeCompare(a.id) : a.at < b.at ? 1 : -1))
    .slice(0, limit)
}

/*
 * One unbroken literal, for the same reason LIBRARY_COLUMNS is one.
 */
const AUDIT_COLUMNS =
  'id, audited_at, checker_version, website_url, final_url, website_status, http_status, duration_ms, error, dns_resolves, is_https, tls_valid, tls_expires_at, is_mobile_friendly, has_title, has_meta_description, has_favicon, is_table_layout, load_ms, copyright_year, platform, platform_version, presence_kind, imprint_url, imprint_has_address, imprint_has_phone, imprint_has_email, imprint_has_vat_id, has_privacy_policy, loads_external_fonts, has_external_maps, contact_form_insecure, psi_state, psi_performance, psi_lcp_ms, psi_cls, psi_error, psi_checked_at, screenshot_path, failed_codes'

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
  imprint_url: string | null
  imprint_has_address: boolean | null
  imprint_has_phone: boolean | null
  imprint_has_email: boolean | null
  imprint_has_vat_id: boolean | null
  has_privacy_policy: boolean | null
  loads_external_fonts: boolean | null
  has_external_maps: boolean | null
  contact_form_insecure: boolean | null
  psi_state: PsiState
  psi_performance: number | null
  psi_lcp_ms: number | null
  psi_cls: number | string | null
  psi_error: string | null
  psi_checked_at: string | null
  screenshot_path: string | null
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
    imprintUrl: record.imprint_url,
    imprintHasAddress: record.imprint_has_address,
    imprintHasPhone: record.imprint_has_phone,
    imprintHasEmail: record.imprint_has_email,
    imprintHasVatId: record.imprint_has_vat_id,
    hasPrivacyPolicy: record.has_privacy_policy,
    loadsExternalFonts: record.loads_external_fonts,
    hasExternalMaps: record.has_external_maps,
    contactFormInsecure: record.contact_form_insecure,
    psiState: record.psi_state,
    psiPerformance: record.psi_performance,
    psiLcpMs: record.psi_lcp_ms,
    psiCls: record.psi_cls === null ? null : Number(record.psi_cls),
    psiError: record.psi_error,
    psiCheckedAt: record.psi_checked_at,
    screenshotPath: record.screenshot_path,
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

  // The score and the history are read alongside rather than after: neither
  // hangs off the audit, and a lead with no audit at all can carry both.
  const [lead, score, previousScore, timeline] = await Promise.all([
    readLead(id),
    readCurrentScore(id),
    readPreviousScore(id),
    readTimeline(id),
  ])
  if (!lead) return null

  const movement = compareScores(previousScore, score)

  const { data: audits } = await supabase
    .from('lead_audits')
    .select(AUDIT_COLUMNS)
    .eq('lead_id', id)
    .order('audited_at', { ascending: false })
    .limit(25)

  const records = (audits ?? []) as unknown as AuditRecord[]
  const newest = records[0] ?? null

  if (!newest) return { lead, audit: null, history: [], score, movement, timeline }

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

  return { lead, audit: toAudit(newest, findings), history, score, movement, timeline }
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
  // The column is `text`, so this is the only thing between a stray paste and a
  // history entry nobody can read past. The save route caps at the same number;
  // the constant is shared so the two cannot drift.
  if (trimmed.length > LIMITS.note) {
    throw new Error(`That note is too long (max ${LIMITS.note} characters).`)
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('lead_notes').insert({ lead_id: leadId, body: trimmed })
  if (error) throw new Error(`Could not save the note: ${error.message}`)
}
