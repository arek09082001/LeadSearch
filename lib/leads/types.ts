/*
 * The library's vocabulary, in one place that both halves may import.
 *
 * Nothing here is `server-only`: the filter bar, the table and the bulk bar are
 * all client components and all speak these types. The repository that runs the
 * queries is the server-only module; its shapes are these.
 */

/** Mirrors public.lead_status. Decided by the operator; see the enum migration. */
export const LEAD_STATUSES = [
  'new',
  'researching',
  'contacted',
  'replied',
  'proposal',
  'won',
  'lost',
  'parked',
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

/** Mirrors public.website_status. */
export type WebsiteStatus = 'no_website' | 'unreachable' | 'reachable' | 'error'

/** Mirrors public.enrichment_state. */
export type EnrichmentState = 'queued' | 'running' | 'done' | 'failed'

/**
 * The audit filters the library offers.
 *
 * Every one of these reads a MEASUREMENT off the newest audit — a fact about a
 * page, not a verdict on it. The criteria that decide whether a site is bad,
 * and what each fault is worth, are explicitly undecided in PRODUCT.md and are
 * not encoded here. When they are decided they arrive as findings, and this
 * list grows to match without a migration.
 */
export const AUDIT_FILTERS = [
  { key: 'no_website', label: 'No website' },
  { key: 'unreachable', label: 'Site unreachable' },
  { key: 'no_https', label: 'No HTTPS' },
  { key: 'not_mobile', label: 'Not mobile-friendly' },
  { key: 'no_meta', label: 'No meta description' },
  { key: 'stale_copyright', label: 'Stale copyright' },
  { key: 'slow', label: 'Slow to load' },
  { key: 'never_audited', label: 'Never audited' },
] as const

export type AuditFilter = (typeof AUDIT_FILTERS)[number]['key']

/** A footer year this far behind is the abandonment tell the audit looks for. */
export const STALE_COPYRIGHT_YEARS = 2
/** Above this, a page is slow enough to be worth saying so. */
export const SLOW_LOAD_MS = 3000

export const FOLLOW_UP_FILTERS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Due this week' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'none', label: 'No date set' },
] as const

export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number]['key']

export const LEAD_SORTS = [
  { key: 'score', label: 'Score' },
  { key: 'saved', label: 'Saved' },
  { key: 'name', label: 'Name' },
  { key: 'city', label: 'City' },
  { key: 'status', label: 'Status' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'audited', label: 'Audited' },
] as const

export type LeadSort = (typeof LEAD_SORTS)[number]['key']

/**
 * Everything the library's URL can say.
 *
 * This is the unit of a saved view, too: a view is a name plus one of these,
 * which is why it is a plain serialisable object with no methods on it.
 */
export interface LeadFilters {
  /** Fuzzy match on business name — search-within-leads. */
  q: string
  status: LeadStatus[]
  listIds: string[]
  cities: string[]
  categories: string[]
  scoreMin: number | null
  scoreMax: number | null
  audit: AuditFilter[]
  followUp: FollowUpFilter | null
  sort: LeadSort
  desc: boolean
  page: number
  /** Show the deleted bin instead of the library. */
  deleted: boolean
}

export const DEFAULT_FILTERS: LeadFilters = {
  q: '',
  status: [],
  listIds: [],
  cities: [],
  categories: [],
  scoreMin: null,
  scoreMax: null,
  audit: [],
  followUp: null,
  // The operator's stated default: highest score first.
  sort: 'score',
  desc: true,
  page: 1,
  deleted: false,
}

export const PAGE_SIZE = 100

/** One row of the library, flattened for the table. */
export interface LeadRow {
  id: string
  googlePlaceId: string
  name: string
  city: string | null
  formattedAddress: string | null
  phone: string | null
  website: string | null
  primaryType: string | null
  rating: number | null
  userRatingCount: number | null
  mapsUri: string | null
  /** Age of every Google-sourced field above. Principle 5: it must be sayable. */
  fetchedAt: string

  status: LeadStatus
  score: number | null
  followUpAt: string | null
  savedAt: string
  deletedAt: string | null

  lastAuditedAt: string | null
  websiteStatus: WebsiteStatus | null
  enrichmentState: EnrichmentState | null
  /** Why the audit pass gave up. About the run, never about the business. */
  enrichmentError: string | null

  /** Measured signals off the newest audit. Null means unknown, never false. */
  isHttps: boolean | null
  isMobileFriendly: boolean | null
  hasMetaDescription: boolean | null
  loadMs: number | null
  copyrightYear: number | null
  platform: string | null

  lists: { id: string; name: string }[]
  noteCount: number
}

export interface LeadListing {
  rows: LeadRow[]
  /** Total matching the filters, before pagination. Drives the pager and select-filtered. */
  total: number
  /** Total saved and not deleted, ignoring filters. Tells an empty result from an empty library. */
  libraryTotal: number
  page: number
  pageSize: number
}

/** Distinct values present in the library, for populating the filter bar. */
export interface LeadFacets {
  cities: { value: string; count: number }[]
  categories: { value: string; count: number }[]
  lists: { id: string; name: string; count: number }[]
  statuses: { value: LeadStatus; count: number }[]
  deletedCount: number
}

/* ------------------------------------------------------------------------- *
 * Saving
 * ------------------------------------------------------------------------- */

/**
 * One candidate, as the search surface hands it over.
 *
 * The client sends the whole place rather than an id, because the transient row
 * it is looking at may expire before it is saved and the server must not have
 * to go back to Google to complete a save the operator already paid for.
 */
export interface SaveCandidate {
  googlePlaceId: string
  name: string
  formattedAddress?: string | null
  lat?: number | null
  lng?: number | null
  phone?: string | null
  website?: string | null
  rating?: number | null
  userRatingCount?: number | null
  businessStatus?: string | null
  primaryType?: string | null
  types?: string[] | null
  mapsUri?: string | null
  raw?: unknown
  /** When this Google data was fetched. Carried through to leads.fetched_at. */
  fetchedAt?: string
}

export interface SaveRequest {
  candidates: SaveCandidate[]
  /** The search this selection came from, for provenance. */
  searchId?: string | null
  /** Existing list to file them under. */
  listId?: string | null
  /** Or a new list to create and file them under. Ignored when listId is set. */
  newListName?: string | null
  /** One note, written onto every lead in the selection. */
  note?: string | null
}

/**
 * What actually happened, per business.
 *
 * Four outcomes rather than a count, because "already there" and "restored" are
 * things the operator needs told: the first means his selection was wider than
 * he thought, the second means he is undoing a delete without knowing it.
 */
export type SaveOutcome = 'saved' | 'updated' | 'restored' | 'failed'

export interface SaveResultItem {
  googlePlaceId: string
  name: string
  outcome: SaveOutcome
  leadId: string | null
  /** Set when outcome is 'failed'. Named, never "something went wrong". */
  error?: string
}

export interface SaveResult {
  items: SaveResultItem[]
  saved: number
  updated: number
  restored: number
  failed: number
  /** The list they were filed under, when one was given or created. */
  list: { id: string; name: string } | null
  /** Leads handed to the background audit pass. */
  enrichmentQueued: number
}

/* ------------------------------------------------------------------------- *
 * Bulk actions
 * ------------------------------------------------------------------------- */

export type BulkAction =
  | { action: 'status'; status: LeadStatus }
  | { action: 'add_to_list'; listId?: string | null; newListName?: string | null }
  | { action: 'remove_from_list'; listId: string }
  | { action: 'follow_up'; followUpAt: string | null }
  | { action: 'delete' }
  | { action: 'restore' }
  | { action: 're_audit' }

export interface BulkResult {
  affected: number
  /** Set by `delete`, so the undo control knows exactly what to put back. */
  undoIds?: string[]
  message: string
}

export interface SavedView {
  id: string
  name: string
  filters: LeadFilters
  position: number
  lastUsedAt: string | null
}
