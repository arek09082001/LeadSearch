import 'server-only'

import { LEAD_STATUSES, LIMITS, type LeadStatus } from '@/lib/leads/types'
import type { LeadType } from '@/lib/mcp/vocabulary'
import type { WeaknessSignal } from '@/lib/services/site-check'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * Working the book from a tool call: finding leads, and changing the two things
 * about them that are the operator's own.
 *
 * `search_places` fills the library and `save_leads` overrules what it threw
 * away. Neither can answer the question that comes next — "what did I say I
 * would come back to, and when" — and neither can be made to. The gap is not a
 * missing parameter, it is that both of those tools are about DISCOVERY and this
 * is about WORK: a lead that already exists, a decision already made about it,
 * and a day to act on it.
 *
 * THE ONE THING NOTHING HERE MAY TOUCH IS `lead_type`.
 *
 * That column is the account of why a business is in the book — `no_website`
 * because Google reported none, `weak_website` because a fetch found a named
 * fault, `manual` because a person decided. It is written once, by the thing
 * that made the decision, and PRODUCT.md's fourth principle (cold recall) is the
 * whole reason it exists. An update path that could set it would let an
 * assistant relabel a lead as `weak_website` without any website ever having
 * been fetched, and nothing on the row would say so. That is also the reason
 * `save_leads` is not the tool for this job: it writes `lead_type = 'manual'` by
 * design, so using it to set a follow-up date would quietly rewrite the history
 * of every lead it touched.
 *
 * So the update surface below is deliberately four fields wide — status,
 * follow-up date, follow-up note, note — and the column list it writes is
 * literal rather than spread from the input.
 */

/* ------------------------------------------------------------------------- *
 * Reading
 * ------------------------------------------------------------------------- */

/**
 * What a listed lead looks like in the tool's answer.
 *
 * The row a decision can be made from and no more. `leads` has sixty-odd
 * columns — every audit measurement, every PageSpeed number, the whole Google
 * snapshot — and an assistant paging through two hundred of them would spend a
 * context window on fields it cannot act on. What is here is what identifies the
 * business, what the operator has already concluded about it, and why it was
 * saved.
 */
export interface ListedLead {
  id: string
  placeId: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  website: string | null
  leadType: LeadType
  weaknessSignals: WeaknessSignal[]
  rating: number | null
  reviewCount: number | null
  status: LeadStatus
  /** A plain day, `2026-08-04`, in the operator's zone. Null means none is set. */
  followUpAt: string | null
  createdAt: string
}

/**
 * The sorts, and why there are only three.
 *
 * Each is a column the cursor below can key on safely, and each answers a
 * question somebody actually asks: what is new, what is due, and what is this
 * business called. Sorting by score or by audit date would be a fourth and a
 * fifth, and both are questions the app's own library surface answers better —
 * it can show the score next to the name.
 */
export const LEAD_SORTS = {
  createdAt: 'created_at',
  followUpAt: 'follow_up_at',
  name: 'name',
} as const

export type LeadSort = keyof typeof LEAD_SORTS

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
/** One call may name this many leads. The same ceiling `search_places` works under. */
export const MAX_BULK_IDS = 200

export interface ListLeadsInput {
  leadType?: LeadType[]
  status?: LeadStatus[]
  city?: string
  /** ISO date or timestamp. A plain date starts at that day's UTC midnight — see the note below. */
  createdAfter?: string
  createdBefore?: string
  /** A plain day. Inclusive: `2026-08-04` includes leads due ON the 4th. */
  followUpBefore?: string
  hasFollowUp?: boolean
  /** Free text, matched against the name. */
  query?: string
  sort?: LeadSort
  /** Default true, which with the default sort is newest first. */
  desc?: boolean
  limit?: number
  cursor?: string
}

export interface ListLeadsResult {
  leads: ListedLead[]
  /** Pass back as `cursor` for the next page. Null when this was the last one. */
  nextCursor: string | null
  /**
   * How many leads match the filters, on the FIRST page only.
   *
   * Omitted once a cursor is in play, and that is honesty rather than an
   * optimisation: the count would then be of what is left after the cursor, and
   * an assistant reading "48" on page two would report 48 to somebody who has
   * already been told 200. One number, once, meaning one thing.
   */
  total?: number
}

/** Exactly the columns `ListedLead` needs, as one literal so supabase-js can infer the row. */
const LIST_COLUMNS =
  'id, google_place_id, name, formatted_address, city, phone, website, lead_type, weakness_signals, rating, user_rating_count, status, follow_up_at, created_at'

interface ListRecord {
  id: string
  google_place_id: string
  name: string
  formatted_address: string | null
  city: string | null
  phone: string | null
  website: string | null
  lead_type: LeadType
  weakness_signals: string[] | null
  rating: number | string | null
  user_rating_count: number | null
  status: LeadStatus
  follow_up_at: string | null
  created_at: string
}

function toListed(record: ListRecord): ListedLead {
  return {
    id: record.id,
    placeId: record.google_place_id,
    name: record.name,
    address: record.formatted_address,
    city: record.city,
    phone: record.phone,
    website: record.website,
    leadType: record.lead_type,
    weaknessSignals: (record.weakness_signals ?? []) as WeaknessSignal[],
    // numeric(2,1) arrives as a string from PostgREST, exactly as it does in
    // lib/leads/repository.ts. A rating that reaches a model as "4.5" instead of
    // 4.5 is a comparison that silently starts working alphabetically.
    rating: record.rating === null ? null : Number(record.rating),
    reviewCount: record.user_rating_count,
    status: record.status,
    followUpAt: record.follow_up_at,
    createdAt: record.created_at,
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A created-at bound, as an instant.
 *
 * THE ZONE HERE IS UTC, AND THAT IS DELIBERATELY NOT WHAT `follow_up_at` DOES.
 *
 * A follow-up date is a day somebody agreed to on the phone, so being one day
 * out means ringing a business on a day nobody named — `lib/mcp/follow-up.ts`
 * resolves those in the operator's own zone for exactly that reason. This is a
 * discovery filter over `created_at`, a timestamptz, and two hours of slop at
 * the boundary costs at most a handful of leads at the edge of a range the
 * caller chose approximately anyway. Matching the ledger's own UTC day (see
 * `startOfUtcDay` in store.ts) is worth more than the hour.
 *
 * `end` is what makes a plain date inclusive. `createdBefore: '2026-08-04'`
 * compared as-is would mean "before midnight on the 4th" and would exclude
 * everything saved that day — which is not what anybody means by "up to the
 * 4th", and would be invisible in the results.
 */
function instantBound(value: string, edge: 'start' | 'end'): string {
  if (!DATE_ONLY.test(value)) return value
  return edge === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`
}

/**
 * `%` and `_` are wildcards to ILIKE, so a name containing one would silently
 * widen the search. The same escape `lib/leads/repository.ts` applies, for the
 * same reason and against the same trigram index.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

/**
 * A value inside PostgREST's `or=()` grammar, where commas and parentheses are
 * syntax.
 *
 * Dates are safe and names are not: `Müller, Bau & Co (GmbH)` interpolated bare
 * would be read as three more conditions and come back as a parse error at best.
 * Double quotes make it one value; backslash escapes make a quote inside it
 * survive.
 */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Where the last page stopped.
 *
 * KEYSET, NOT AN OFFSET, and the difference matters more here than it would on a
 * screen. An assistant pages through this while `search_places` may be writing
 * to the same table from another call; with an offset, a lead inserted ahead of
 * the cursor shifts every later row down one and page two silently re-reads a
 * lead page one already showed — or skips one entirely. A keyset says "after
 * this exact row", which stays true whatever else is inserted.
 *
 * The sort is carried in the cursor and checked on the way back in, because a
 * cursor is only meaningful against the ordering that produced it: replaying one
 * from a name-sorted page against a date-sorted query would silently return the
 * wrong slice rather than fail.
 */
interface Cursor {
  /** The sort column's value on the last row. Null means the run of nulls at the end. */
  v: string | null
  /** That row's id — the tiebreaker, so two leads sharing a date cannot hide each other. */
  i: string
  s: LeadSort
  d: boolean
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export class CursorError extends Error {}

function decodeCursor(raw: string, sort: LeadSort, desc: boolean): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw new CursorError('That cursor is not one this tool issued.')
  }

  const cursor = parsed as Partial<Cursor>
  if (typeof cursor?.i !== 'string' || (cursor.v !== null && typeof cursor.v !== 'string')) {
    throw new CursorError('That cursor is not one this tool issued.')
  }
  if (cursor.s !== sort || cursor.d !== desc) {
    throw new CursorError(
      `That cursor was issued for sort="${cursor.s}" desc=${cursor.d}. Page with the same sort it started with, or start again without a cursor.`,
    )
  }
  return { v: cursor.v, i: cursor.i, s: sort, d: desc }
}

/**
 * The narrowing methods this function uses, declared structurally.
 *
 * Same reason `lib/leads/repository.ts` does it: constraining a type parameter
 * to PostgREST's own builder generics makes the checker recurse until it gives
 * up (TS2589). The builder is cast to this once and the call sites stay typed
 * either side.
 */
interface Filterable {
  is(column: string, value: null): Filterable
  not(column: string, operator: string, value: null): Filterable
  eq(column: string, value: unknown): Filterable
  in(column: string, values: readonly unknown[]): Filterable
  gt(column: string, value: unknown): Filterable
  gte(column: string, value: unknown): Filterable
  lte(column: string, value: unknown): Filterable
  ilike(column: string, pattern: string): Filterable
  or(filters: string): Filterable
}

function applyFilters<T>(query: T, input: ListLeadsInput): T {
  /*
   * Soft-deleted leads are never listed, and there is no flag to include them.
   *
   * The operator threw them out. A tool that offered them back would be handing
   * an assistant a list of businesses to work that he has already decided
   * against, with nothing in the row saying so.
   */
  let result = (query as Filterable).is('deleted_at', null)

  if (input.leadType?.length) result = result.in('lead_type', input.leadType)
  if (input.status?.length) result = result.in('status', input.status)
  // ILIKE without wildcards is case-insensitive equality: forgiving about
  // "heilbronn" and still strict about which town it is.
  if (input.city?.trim()) result = result.ilike('city', escapeLike(input.city.trim()))
  if (input.query?.trim()) result = result.ilike('name', `%${escapeLike(input.query.trim())}%`)

  if (input.createdAfter) result = result.gte('created_at', instantBound(input.createdAfter, 'start'))
  if (input.createdBefore) result = result.lte('created_at', instantBound(input.createdBefore, 'end'))

  /*
   * Inclusive, and the tool description says so in as many words.
   *
   * "Before the 4th" read strictly would exclude everything due on the 4th, and
   * the question this filter exists for — what is due by then — includes it. It
   * is the same comparison the app's own "Due now" filter makes (`lte today()`
   * in lib/leads/repository.ts), so the two surfaces cannot disagree about which
   * leads are due.
   */
  if (input.followUpBefore) result = result.lte('follow_up_at', input.followUpBefore)

  if (input.hasFollowUp === true) result = result.not('follow_up_at', 'is', null)
  if (input.hasFollowUp === false) result = result.is('follow_up_at', null)

  return result as T
}

export async function listLeads(input: ListLeadsInput): Promise<ListLeadsResult> {
  const sort = input.sort ?? 'createdAt'
  const desc = input.desc ?? true
  const column = LEAD_SORTS[sort]
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const cursor = input.cursor ? decodeCursor(input.cursor, sort, desc) : null

  const supabase = createServiceClient()

  let query = supabase
    .from('leads')
    .select(LIST_COLUMNS, cursor ? undefined : { count: 'exact' })

  query = applyFilters(query, input)

  if (cursor) {
    const builder = query as unknown as Filterable
    if (cursor.v === null) {
      /*
       * Inside the run of nulls at the end. `follow_up_at` is the only sortable
       * column here that has any, and a lead with no date set is ordered after
       * every lead that has one — so once the cursor is in that run, the only
       * thing left to page on is the id.
       */
      query = builder.is(column, null).gt('id', cursor.i) as unknown as typeof query
    } else {
      /*
       * "Strictly past the value, or level with it and past the id, or a null."
       *
       * The third clause is what keeps the nulls reachable. PostgREST evaluates
       * the first two as SQL comparisons, and a comparison against null is never
       * true — without `is.null` the page would stop dead at the last row that
       * has a date and report `nextCursor: null` with leads still to come.
       */
      const step = desc ? 'lt' : 'gt'
      query = builder.or(
        `${column}.${step}.${quoted(cursor.v)},and(${column}.eq.${quoted(cursor.v)},id.gt.${cursor.i}),${column}.is.null`,
      ) as unknown as typeof query
    }
  }

  const { data, error, count } = await query
    // Nulls last in both directions, so "no follow-up set" is always the tail
    // rather than the head of a descending page — and so the cursor's null
    // branch above has one shape instead of two.
    .order(column, { ascending: !desc, nullsFirst: false })
    // The tiebreaker is always ascending, whichever way the sort runs. It only
    // has to be CONSISTENT with the keyset's `id.gt.` above; making it follow
    // `desc` would break the pairing and start dropping rows that share a date.
    .order('id', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Could not read the leads library: ${error.message}`)

  const records = (data ?? []) as unknown as ListRecord[]
  const leads = records.map(toListed)

  /*
   * A full page means there MAY be more, not that there is. Asking for one extra
   * row to find out would be a second answer to a question the caller can settle
   * for free by paging once more and getting nothing — and it would make every
   * page fetch a row it throws away.
   */
  const last = records[records.length - 1]
  const nextCursor =
    records.length === limit && last
      ? encodeCursor({
          v: (last as unknown as Record<string, string | null>)[column] ?? null,
          i: last.id,
          s: sort,
          d: desc,
        })
      : null

  return {
    leads,
    nextCursor,
    ...(cursor ? {} : { total: count ?? leads.length }),
  }
}

/* ------------------------------------------------------------------------- *
 * Writing
 * ------------------------------------------------------------------------- */

/**
 * A change to one or many leads, with every date already resolved.
 *
 * `followUpAt` arrives here as a plain day or an explicit null — never as
 * "tomorrow". Parsing happens at the tool boundary, before a single row is
 * touched, so a malformed date fails the call instead of updating half a
 * hundred leads and then discovering the day was unreadable.
 *
 * `undefined` and `null` are different answers and stay that way: undefined
 * leaves the column alone, null clears it.
 */
export interface LeadUpdate {
  status?: LeadStatus
  followUpAt?: string | null
  followUpNote?: string
  note?: string
}

export interface BulkUpdateResult {
  updated: number
  updatedIds: string[]
  /** Named but not updated: no such lead, or one the operator has deleted. */
  notFound: string[]
  notesAdded: number
  /** Present only when something went partly wrong. */
  notice?: string
}

export function isEmptyUpdate(update: LeadUpdate): boolean {
  return (
    update.status === undefined &&
    update.followUpAt === undefined &&
    !update.followUpNote?.trim() &&
    !update.note?.trim()
  )
}

/**
 * The note bodies a change writes, at most two.
 *
 * `follow_up_note` is deliberately NOT a column. `lead_notes` already holds the
 * operator's own account of a lead — appended, timestamped, never overwritten,
 * and rendered in the timeline beside the status changes it explains. A second
 * home for one sentence would mean the reason for a callback lived somewhere the
 * lead's own history does not show, and would be silently lost the moment the
 * date was cleared.
 *
 * So a follow-up note becomes a note, with the date it belongs to written into
 * it. `Follow-up 2026-08-14: owner back from holiday` reads correctly in October
 * whatever has happened to the column since, which is what the history is for.
 */
function noteBodies(update: LeadUpdate): string[] {
  const bodies: string[] = []

  const followUpNote = update.followUpNote?.trim()
  if (followUpNote) {
    const day = update.followUpAt ? ` ${update.followUpAt}` : ''
    bodies.push(`Follow-up${day}: ${followUpNote}`)
  }

  const note = update.note?.trim()
  if (note) bodies.push(note)

  return bodies
}

export class LeadUpdateError extends Error {}

function checkNoteLengths(bodies: string[]): void {
  for (const body of bodies) {
    // The same ceiling `addNote` and the save route enforce. Checked here rather
    // than left to the `text` column so the caller is told which field was too
    // long instead of being handed a database error about a table it cannot see.
    if (body.length > LIMITS.note) {
      throw new LeadUpdateError(`That note is too long (max ${LIMITS.note} characters).`)
    }
  }
}

function assertStatus(status: string | undefined): asserts status is LeadStatus | undefined {
  if (status !== undefined && !LEAD_STATUSES.includes(status as LeadStatus)) {
    throw new LeadUpdateError(
      `"${status}" is not a status this product has. One of: ${LEAD_STATUSES.join(', ')}.`,
    )
  }
}

/**
 * Change many leads, and say plainly which ones were not there.
 *
 * PARTIAL SUCCESS IS THE CONTRACT, not a degraded mode. An assistant working
 * from a list it built a minute ago will name leads the operator has deleted
 * since, and refusing all two hundred over one of them would make the tool
 * useless exactly when it is most useful. What it may never do is report those
 * as updated — `notFound` is the field that keeps the count honest.
 *
 * `lead_type` is not in the payload and cannot be put there. See the note at the
 * top of this file.
 */
export async function bulkUpdateLeads(
  leadIds: string[],
  update: LeadUpdate,
): Promise<BulkUpdateResult> {
  assertStatus(update.status)

  if (!leadIds.length) throw new LeadUpdateError('Name at least one lead.')
  if (leadIds.length > MAX_BULK_IDS) {
    throw new LeadUpdateError(`That is more than ${MAX_BULK_IDS} leads in one call.`)
  }
  if (isEmptyUpdate(update)) {
    throw new LeadUpdateError('Nothing to change. Give a status, a follow-up date, or a note.')
  }

  const bodies = noteBodies(update)
  checkNoteLengths(bodies)

  const supabase = createServiceClient()

  // Deduplicated, so a list naming the same lead twice writes one note rather
  // than two identical ones a minute apart in the history.
  const requested = [...new Set(leadIds)]

  /*
   * Which of them are really there, asked FIRST and separately.
   *
   * The update below could report its own affected rows, and for a column patch
   * that would be enough. It is not enough when the only change is a note: there
   * is no column patch to count, and inserting notes against ids that do not
   * exist would fail the whole statement on the foreign key rather than skip
   * them. One extra index lookup buys both halves the same answer.
   */
  const { data: found, error: readError } = await supabase
    .from('leads')
    .select('id')
    .in('id', requested)
    // Soft-deleted counts as not found, which is the same line `listLeads`
    // draws. A lead in the bin is one the operator threw out.
    .is('deleted_at', null)

  if (readError) throw new Error(`Could not read the leads: ${readError.message}`)

  const foundIds = ((found ?? []) as { id: string }[]).map((row) => row.id)
  const foundSet = new Set(foundIds)
  const notFound = requested.filter((id) => !foundSet.has(id))

  if (!foundIds.length) {
    return { updated: 0, updatedIds: [], notFound, notesAdded: 0 }
  }

  /*
   * The column payload, written out field by field.
   *
   * Never a spread of the input. A spread is how `lead_type` — or `deleted_at`,
   * or `current_score` — ends up in an update statement the day somebody adds a
   * field to the input type and forgets this line exists.
   */
  const payload: Record<string, unknown> = {}
  if (update.status !== undefined) payload.status = update.status
  if (update.followUpAt !== undefined) payload.follow_up_at = update.followUpAt

  let updatedIds = foundIds
  if (Object.keys(payload).length) {
    const { data, error } = await supabase
      .from('leads')
      .update(payload)
      .in('id', foundIds)
      .select('id')
    if (error) throw new Error(`Could not update the leads: ${error.message}`)
    updatedIds = ((data ?? []) as { id: string }[]).map((row) => row.id)
  }

  let notesAdded = 0
  let notice: string | undefined

  if (bodies.length) {
    const rows = updatedIds.flatMap((leadId) => bodies.map((body) => ({ lead_id: leadId, body })))
    const { error } = await supabase.from('lead_notes').insert(rows)
    if (error) {
      /*
       * Reported, never thrown, and only because the column change has already
       * happened. Throwing here would tell the caller the whole call failed
       * while the statuses and dates are on disk — and the obvious response to
       * that, retrying, would then write the dates twice. A named partial
       * failure is the only answer that leads anywhere.
       */
      notice = `The leads were updated but the note could not be written: ${error.message}`
      console.error('[mcp] could not write lead notes', error.message)
    } else {
      notesAdded = rows.length
    }
  }

  return {
    updated: updatedIds.length,
    updatedIds,
    notFound,
    notesAdded,
    ...(notice ? { notice } : {}),
  }
}

export interface UpdateLeadResult {
  updated: boolean
  lead: ListedLead | null
  notesAdded: number
  notice?: string
}

/**
 * One lead, and the row as it now stands.
 *
 * The lead comes back because this is the one call where reading it costs
 * nothing worth mentioning and answers the question the caller has next: did the
 * date land on the day I meant. `"+3d"` going in and `2026-08-07` coming out is
 * the only way an assistant can check its own arithmetic against the operator's
 * calendar rather than the host's.
 */
export async function updateLead(leadId: string, update: LeadUpdate): Promise<UpdateLeadResult> {
  const result = await bulkUpdateLeads([leadId], update)

  if (!result.updated) {
    return { updated: false, lead: null, notesAdded: 0, notice: 'No such lead.' }
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.from('leads').select(LIST_COLUMNS).eq('id', leadId).single()

  return {
    updated: true,
    // A read that fails after a write that did not is not a failed update, and
    // saying so would invite a retry that writes the note a second time.
    lead: error ? null : toListed(data as unknown as ListRecord),
    notesAdded: result.notesAdded,
    ...(result.notice ? { notice: result.notice } : {}),
  }
}
