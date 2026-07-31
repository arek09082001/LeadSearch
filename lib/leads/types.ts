import { CHANGE_CODES, type ChangeCode } from '@/lib/leads/changes'
import {
  FINDING_CODES,
  FINDING_SPECS,
  type FindingCode,
  type FindingSeverity,
} from '@/lib/enrichment/vocabulary'
import type { ScoreMovement, StoredScore } from '@/lib/scoring/score'

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

/** Mirrors public.activity_type — the outreach log's vocabulary. */
export const ACTIVITY_TYPES = [
  'call',
  'email',
  'message',
  'visit',
  'meeting',
  'status_change',
  'other',
] as const

export type ActivityType = (typeof ACTIVITY_TYPES)[number]

/** Mirrors public.website_status. */
export type WebsiteStatus = 'no_website' | 'unreachable' | 'reachable' | 'error'

/** Mirrors public.enrichment_state. */
export type EnrichmentState = 'queued' | 'running' | 'done' | 'failed'

/** Mirrors public.psi_state — the PageSpeed stage's own lifecycle. */
export type PsiState = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

/**
 * The absence of an audit, as something filterable.
 *
 * Not a finding — a lead with no audit has no findings to have. The library
 * view synthesises it into `audit_flags` anyway, so that every audit filter,
 * including this one, is a single overlap test against one array. See the view
 * definition for why that is worth a little synthesis.
 */
export const NEVER_AUDITED = 'never_audited'

/**
 * The audit filters the library offers: one per finding the audit can produce,
 * plus the absence of an audit.
 *
 * Derived from the finding vocabulary rather than restated, so a new check is
 * filterable the moment it exists — no migration, and no chance of the menu and
 * the pass disagreeing about what a code means.
 */
export const AUDIT_FILTERS = [
  ...FINDING_CODES.map((code) => ({
    key: code as FindingCode | typeof NEVER_AUDITED,
    label: FINDING_SPECS[code].mark,
    category: FINDING_SPECS[code].category as string,
  })),
  { key: NEVER_AUDITED as FindingCode | typeof NEVER_AUDITED, label: 'Never audited', category: 'other' },
]

export type AuditFilter = FindingCode | typeof NEVER_AUDITED

/**
 * The change filters: one per code the refresh pass can report.
 *
 * Derived from the change vocabulary for the same reason the audit filters are
 * derived from the finding vocabulary — a new code is filterable the moment it
 * exists, and the menu cannot drift from what the pass writes.
 *
 * There is deliberately no "nothing changed" entry to mirror `never_audited`.
 * That is the steady state of the whole book, and a filter for it would return
 * everything.
 */
export type ChangeFilter = ChangeCode

export const CHANGE_FILTER_KEYS: readonly ChangeCode[] = CHANGE_CODES

export const FOLLOW_UP_FILTERS = [
  // Overdue and today as one question, because that is the one the Outreach
  // queue asks: a follow-up that has arrived is due whether it arrived this
  // morning or a fortnight ago.
  { key: 'now', label: 'Due now' },
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
  { key: 'changed', label: 'Changed' },
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
  /** What the refresh pass last found. Empty means "don't care", never "nothing changed". */
  change: ChangeFilter[]
  /** Only leads with an email address off their Impressum — the writable list. */
  hasEmail: boolean
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
  change: [],
  hasEmail: false,
  followUp: null,
  // The operator's stated default: highest score first.
  sort: 'score',
  desc: true,
  page: 1,
  deleted: false,
}

export const PAGE_SIZE = 100

/**
 * The library's own limits, in one place both halves may read.
 *
 * Every one of these is enforced on the server, because a client-side cap is a
 * courtesy and not a constraint. They are stated here so the field that takes
 * the input can carry the same number the route rejects at — a textarea that
 * lets him type four thousand characters and then throws them away on save is
 * worse than one that stops him at two.
 */
export const LIMITS = {
  /** A note. Long enough for what happened on a call, short enough to read back. */
  note: 2000,
  /** A list name, and a saved view's. Both are read in a one-line bar. */
  name: 60,
  /** The furthest page the pager will address. Past the end of any real book. */
  page: 10_000,
} as const

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

  /**
   * Read off the business's own Impressum, not off Google — which is the point:
   * Google supplies a phone number and almost never an email, and this is what
   * makes written outreach possible at all.
   */
  imprintEmail: string | null
  imprintPhone: string | null
  imprintFetchedAt: string | null

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
  dnsResolves: boolean | null
  isHttps: boolean | null
  tlsValid: boolean | null
  isMobileFriendly: boolean | null
  hasTitle: boolean | null
  hasMetaDescription: boolean | null
  hasFavicon: boolean | null
  isTableLayout: boolean | null
  loadMs: number | null
  copyrightYear: number | null
  platform: string | null
  platformVersion: string | null
  presenceKind: string | null

  /** PageSpeed, which arrives a stage later than everything above it. */
  psiState: PsiState | null
  psiPerformance: number | null
  psiLcpMs: number | null
  psiCls: number | null

  /**
   * The newest audit's failed finding codes — the diagnosis, as marks.
   *
   * Rendered through the shared vocabulary rather than through per-column
   * logic, so the row and the detail page cannot disagree about what was found.
   * Holds the single synthetic `never_audited` when there is no audit at all.
   */
  auditFlags: string[]

  /**
   * What the refresh pass last found had changed about this business.
   *
   * Rendered through the change vocabulary, exactly as `auditFlags` is rendered
   * through the finding vocabulary. Empty is the steady state. It holds the LAST
   * change rather than every change ever, and `changedAt` says when — so a mark
   * that has been on a row for two months is still telling the truth.
   */
  changeFlags: string[]
  /** When those changes were found. Null when nothing has ever changed. */
  changedAt: string | null
  /** Why the last Google re-pull failed. About the request, never the business. */
  refreshError: string | null

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

/* ------------------------------------------------------------------------- *
 * The same library, drawn as points
 * ------------------------------------------------------------------------- */

/**
 * One lead as the map draws it, and nothing more.
 *
 * A deliberately smaller thing than `LeadRow`. The map draws points, not table
 * rows: it needs somewhere to put the mark, something to label it with, and the
 * two facts worth colouring it by. Everything else — the address, the audit
 * measurements, the lists, the note count — is what the detail route is for, and
 * shipping it for two thousand pins would be most of a megabyte nobody reads.
 *
 * The field names are `LeadRow`'s, not the view's, so a point and a row cannot
 * disagree about what `score` or `auditFlags` mean.
 */
export interface LeadPoint {
  id: string
  lat: number
  lng: number
  name: string
  score: number | null
  status: LeadStatus
  /** Rendered through the same vocabulary the table's marks come from. */
  auditFlags: string[]
}

/**
 * A viewport, in degrees.
 *
 * Not part of `LeadFilters`, and that is the point: filters say which leads
 * exist, a viewport says which part of the world is on screen. Folding it in
 * would put the map's scroll position into every saved view and every bookmarked
 * URL, and a view named "Heilbronn, no website" would silently also mean
 * "wherever the map happened to be pointing when I saved it".
 *
 * `west` may exceed `east`: that is a box crossing the antimeridian, which is
 * what a map pans across rather than an error.
 */
export interface LeadBounds {
  north: number
  south: number
  east: number
  west: number
}

/** What the map asked for, with the ceiling it was answered under stated. */
export interface LeadPointSet {
  points: LeadPoint[]
  /**
   * True when the box held more than `limit` leads. The highest-scoring
   * survived, so a truncated map still shows the ones worth calling — but it is
   * said out loud rather than left to be noticed.
   */
  truncated: boolean
  limit: number
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
  /** Ask Google what has changed. The one bulk action that spends money. */
  | { action: 'refresh' }

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

/* ------------------------------------------------------------------------- *
 * The diagnosis
 * ------------------------------------------------------------------------- */

/** One judgement, with the evidence that produced it. */
export interface AuditFinding {
  code: string
  category: string
  severity: FindingSeverity
  passed: boolean
  /** The proof. A PageSpeed score of 23 is a sales argument, not just a number. */
  value: Record<string, unknown> | null
  message: string
}

/** One audit in full: what was observed, and what was concluded from it. */
export interface LeadAudit {
  id: string
  auditedAt: string
  checkerVersion: string

  websiteUrl: string | null
  finalUrl: string | null
  websiteStatus: WebsiteStatus
  httpStatus: number | null
  durationMs: number | null
  error: string | null

  dnsResolves: boolean | null
  isHttps: boolean | null
  tlsValid: boolean | null
  tlsExpiresAt: string | null
  isMobileFriendly: boolean | null
  hasTitle: boolean | null
  hasMetaDescription: boolean | null
  hasFavicon: boolean | null
  isTableLayout: boolean | null
  loadMs: number | null
  copyrightYear: number | null
  platform: string | null
  platformVersion: string | null
  presenceKind: string | null

  /**
   * What the site says about itself. Null throughout on an audit written before
   * the Impressum check existed — `checkerVersion` is what tells that apart
   * from an audit that looked and found nothing.
   */
  imprintUrl: string | null
  imprintHasAddress: boolean | null
  imprintHasPhone: boolean | null
  imprintHasEmail: boolean | null
  imprintHasVatId: boolean | null
  hasPrivacyPolicy: boolean | null
  loadsExternalFonts: boolean | null
  hasExternalMaps: boolean | null
  contactFormInsecure: boolean | null

  psiState: PsiState
  psiPerformance: number | null
  psiLcpMs: number | null
  psiCls: number | null
  psiError: string | null
  psiCheckedAt: string | null
  /**
   * Object key for the mobile screenshot Lighthouse returned with the PageSpeed
   * run, or null when there is none — which includes every audit that never
   * reached that stage.
   *
   * A key, never a URL. The bucket is private; the surface asks
   * /api/audits/[id]/screenshot for a signed link, and that route checks the
   * session before it signs anything.
   */
  screenshotPath: string | null

  findings: AuditFinding[]
}

/** A past audit, as one line. Enough to see that somebody finally fixed the site. */
export interface AuditSummary {
  id: string
  auditedAt: string
  websiteStatus: WebsiteStatus
  checkerVersion: string
  failedCodes: string[]
  psiPerformance: number | null
}

/* ------------------------------------------------------------------------- *
 * The history
 * ------------------------------------------------------------------------- */

/**
 * One line of what happened to this lead, from either of the two tables that
 * record it.
 *
 * `lead_activities` and `lead_notes` are kept apart in the schema for good
 * reasons — one is appended by a trigger, the other is prose the operator typed
 * — but that split is the database's problem, not his. He worked this lead
 * once, in one order, so it comes back as one sequence. The `kind` says which
 * table a line came from; nothing above this type has to care.
 */
export interface TimelineEntry {
  /** Namespaced across the tables: `note:<uuid>`, `activity:<bigint>`, `refresh:<uuid>`. */
  id: string
  kind: 'note' | 'activity' | 'refresh'
  /** The activity's type. Null on notes and refreshes, which are not activity types. */
  type: ActivityType | null
  at: string
  /** The note's text, an activity's summary, or the sentence describing a change. */
  body: string | null
  statusBefore: LeadStatus | null
  statusAfter: LeadStatus | null
  /**
   * Change codes, on refresh entries only.
   *
   * Carried as codes rather than baked into `body` so the timeline renders them
   * through the same vocabulary the table's marks come from — the history and
   * the row cannot disagree about what happened.
   */
  changes?: string[]
}

export interface LeadDetail {
  lead: LeadRow
  /** The newest audit, in full. Null when nothing has audited this lead yet. */
  audit: LeadAudit | null
  /** Every audit before it, newest first. History is the point of re-running. */
  history: AuditSummary[]
  /**
   * The score on the lead, with the arithmetic that produced it.
   *
   * The same row `leads.current_score` was denormalised from, so the number in
   * the book and the reasoning on this page cannot disagree. Null when nothing
   * has scored the lead yet — which is not the same as a score of null, and the
   * breakdown inside says which.
   */
  score: StoredScore | null
  /**
   * How the score moved, and which faults moved it.
   *
   * The lead that finally built a website is the case this exists for: its
   * score falls by sixty points, and a number that fell sixty points without
   * saying why is a number the operator stops believing. Null when there is
   * nothing to compare against — the first score of a lead's life has not
   * moved.
   */
  movement: ScoreMovement | null
  /** Status changes, notes and Google changes as one sequence, newest first. */
  timeline: TimelineEntry[]
}

/* ------------------------------------------------------------------------- *
 * The outreach queues
 * ------------------------------------------------------------------------- */

/**
 * What counts as a high scorer worth calling unprompted.
 *
 * PRODUCT.md left "cold" undecided; the operator has now decided it, and this
 * is the number that decision reduces to. It is a floor rather than a ranking:
 * everything above it is worth the call, and the queue orders by score inside
 * that. 60 sits above the point where the scale stops describing real damage —
 * `no_website` alone lands a well-reviewed business in the nineties, while a
 * long tail of hygiene complaints on an unproven one does not reach here.
 */
export const COLD_SCORE_FLOOR = 60

/** The two queues the Outreach surface is made of. */
export interface OutreachQueues {
  /** Follow-ups that have arrived, most overdue first. */
  due: LeadListing
  /** High scorers never worked and never scheduled, best first. */
  cold: LeadListing
}
