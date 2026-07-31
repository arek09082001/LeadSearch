import {
  AUDIT_FILTERS,
  COLD_SCORE_FLOOR,
  DEFAULT_FILTERS,
  FOLLOW_UP_FILTERS,
  LEAD_SORTS,
  LEAD_STATUSES,
  type AuditFilter,
  type FollowUpFilter,
  type LeadFilters,
  type LeadSort,
  type LeadStatus,
} from '@/lib/leads/types'

/*
 * The URL is the filter state. Not a mirror of it — the state itself.
 *
 * Three things fall out of that, all of them things the operator asked for
 * without asking for them: a filtered library is a link he can bookmark, the
 * back button steps through his filtering, and a saved view is just this object
 * under a name. Nothing here is server-only, because the filter bar on the
 * client and the page on the server must agree byte for byte on what a URL
 * means.
 *
 * Multi-value filters are repeated keys (`?city=Neuss&city=Heilbronn`) rather
 * than a joined string. A comma in a city name is not hypothetical.
 */

/** Anything indexable by string that can hand back one or many values. */
type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>

function readAll(source: ParamSource, key: string): string[] {
  if (source instanceof URLSearchParams) return source.getAll(key)
  const value = source[key]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function readOne(source: ParamSource, key: string): string | undefined {
  return readAll(source, key)[0]
}

/** Keep only values the type system recognises; a stale bookmark must not 500. */
function only<T extends string>(values: string[], allowed: readonly T[]): T[] {
  const set = new Set<string>(allowed)
  // Deduplicate as well as validate: `?status=new&status=new` is one filter.
  return [...new Set(values.filter((value): value is T => set.has(value)))]
}

function readScore(source: ParamSource, key: string): number | null {
  const raw = readOne(source, key)
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function parseFilters(source: ParamSource): LeadFilters {
  const sort = readOne(source, 'sort')
  const scoreMin = readScore(source, 'smin')
  const scoreMax = readScore(source, 'smax')
  const page = Number(readOne(source, 'page') ?? '1')
  const followUp = readOne(source, 'due')

  return {
    q: (readOne(source, 'q') ?? '').trim().slice(0, 120),
    status: only<LeadStatus>(readAll(source, 'status'), LEAD_STATUSES),
    listIds: readAll(source, 'list').filter(Boolean).slice(0, 20),
    cities: readAll(source, 'city').filter(Boolean).slice(0, 20),
    categories: readAll(source, 'cat').filter(Boolean).slice(0, 20),
    // A range typed backwards is the operator mid-keystroke, not an error worth
    // an empty table. Swapping is what he meant.
    scoreMin: scoreMin !== null && scoreMax !== null ? Math.min(scoreMin, scoreMax) : scoreMin,
    scoreMax: scoreMin !== null && scoreMax !== null ? Math.max(scoreMin, scoreMax) : scoreMax,
    audit: only<AuditFilter>(
      readAll(source, 'audit'),
      AUDIT_FILTERS.map((entry) => entry.key),
    ),
    followUp:
      followUp && FOLLOW_UP_FILTERS.some((entry) => entry.key === followUp)
        ? (followUp as FollowUpFilter)
        : null,
    sort: LEAD_SORTS.some((entry) => entry.key === sort)
      ? (sort as LeadSort)
      : DEFAULT_FILTERS.sort,
    // Absent means the sort's own natural direction, which for score is high
    // first. Only an explicit `dir=asc` flips it.
    desc: readOne(source, 'dir') === 'asc' ? false : naturalDesc(sort as LeadSort),
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) : 1,
    deleted: readOne(source, 'bin') === '1',
  }
}

/* ------------------------------------------------------------------------- *
 * The outreach queues, as questions about the book
 * ------------------------------------------------------------------------- */

/**
 * The two queues are filter sets, not separate tables.
 *
 * Which means the Outreach surface can hand the operator a link straight into
 * the library showing exactly the same rows, and a queue can never disagree
 * with the book about who is in it. It also means neither queue needed a query
 * of its own: they are `queryLeads` with the filters below.
 */
export function dueFilters(): LeadFilters {
  // Most overdue first: the one that has been waiting longest is the one he is
  // furthest behind on, and it is the top of the list for that reason alone.
  return { ...DEFAULT_FILTERS, followUp: 'now', sort: 'follow_up', desc: false }
}

/**
 * High scorers never touched.
 *
 * `followUp: 'none'` is what keeps the two queues from overlapping, and it is
 * also the honest reading of cold: a lead he has already put a date on is
 * scheduled, not neglected — it belongs in Due when that date arrives and
 * nowhere until then.
 */
export function coldFilters(): LeadFilters {
  return {
    ...DEFAULT_FILTERS,
    status: ['new'],
    scoreMin: COLD_SCORE_FLOOR,
    followUp: 'none',
    sort: 'score',
    desc: true,
  }
}

/**
 * Which way a column wants to sort the first time it is clicked.
 *
 * Measures go high-first because the interesting end is the top; names and
 * dates-to-act-on go low-first because the interesting end is the beginning.
 */
export function naturalDesc(sort: LeadSort | undefined): boolean {
  switch (sort) {
    case 'name':
    case 'city':
    case 'status':
    case 'follow_up':
      return false
    default:
      return true
  }
}

/**
 * The inverse. Only non-default values are written, so a library at rest has a
 * clean `/leads` in the address bar rather than a wall of defaults.
 */
export function toSearchParams(filters: LeadFilters): URLSearchParams {
  const params = new URLSearchParams()

  if (filters.q) params.set('q', filters.q)
  for (const status of filters.status) params.append('status', status)
  for (const listId of filters.listIds) params.append('list', listId)
  for (const city of filters.cities) params.append('city', city)
  for (const category of filters.categories) params.append('cat', category)
  if (filters.scoreMin !== null) params.set('smin', String(filters.scoreMin))
  if (filters.scoreMax !== null) params.set('smax', String(filters.scoreMax))
  for (const audit of filters.audit) params.append('audit', audit)
  if (filters.followUp) params.set('due', filters.followUp)
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort)
  if (filters.desc !== naturalDesc(filters.sort)) params.set('dir', filters.desc ? 'desc' : 'asc')
  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.deleted) params.set('bin', '1')

  return params
}

export function filtersToHref(filters: LeadFilters): string {
  const query = toSearchParams(filters).toString()
  return query ? `/leads?${query}` : '/leads'
}

/**
 * How many filters are narrowing the view.
 *
 * Sort, page and the bin are excluded on purpose: they change what you are
 * looking at, not how much of it, and counting them would make "clear filters"
 * look like it had something to do when it did not.
 */
export function activeFilterCount(filters: LeadFilters): number {
  return (
    (filters.q ? 1 : 0) +
    filters.status.length +
    filters.listIds.length +
    filters.cities.length +
    filters.categories.length +
    (filters.scoreMin !== null ? 1 : 0) +
    (filters.scoreMax !== null ? 1 : 0) +
    filters.audit.length +
    (filters.followUp ? 1 : 0)
  )
}

/**
 * Do two filter sets describe the same view?
 *
 * Compared through the URL codec rather than field by field, so it stays true
 * as filters are added and so `?status=new&status=won` matches a view saved as
 * `[won, new]`. Page is dropped: page 2 of a view is still that view.
 */
export function sameFilters(a: LeadFilters, b: LeadFilters): boolean {
  const normalize = (filters: LeadFilters) => {
    const params = toSearchParams({ ...filters, page: 1 })
    const entries = [...params.entries()].map(([key, value]) => `${key}=${value}`)
    return entries.sort().join('&')
  }
  return normalize(a) === normalize(b)
}

/** Widen a stored view into a full filter object, tolerating an older shape. */
export function coerceFilters(value: unknown): LeadFilters {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_FILTERS }
  // Round-tripping through the codec is what makes an old or hand-edited view
  // safe: anything unrecognised is dropped by the parser rather than trusted.
  const params = new URLSearchParams()
  const record = value as Record<string, unknown>

  for (const [key, raw] of Object.entries(record)) {
    if (Array.isArray(raw)) {
      for (const entry of raw) params.append(key, String(entry))
    } else if (raw !== null && raw !== undefined && typeof raw !== 'object') {
      params.set(key, String(raw))
    }
  }

  return parseFilters(params)
}

/** The storage shape of a saved view: the URL, as an object. */
export function filtersToJson(filters: LeadFilters): Record<string, string | string[]> {
  const params = toSearchParams({ ...filters, page: 1 })
  const json: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    json[key] = values.length > 1 ? values : values[0]
  }
  return json
}
