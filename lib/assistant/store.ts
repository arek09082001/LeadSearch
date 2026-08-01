import 'server-only'

import type {
  Briefing,
  BriefingReview,
  Speaker,
  StoredBriefing,
  TranscriptSegment,
} from '@/lib/assistant/types'
import type { ProviderReview } from '@/lib/providers/types'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * The half that knows column names.
 *
 * `briefing-input.ts` is pure and the mock provider is pure; everything that
 * touches Postgres is here, which is the split `scoring/score.ts` and
 * `scoring/store.ts` draw and for the same reason — the reasoning has to be
 * readable without a database in the room.
 *
 * Two caches live in this file and they are not the same kind of thing:
 *
 *   REVIEWS are Google's, transient, and expire on a clock the database
 *   enforces. Read-through: a fetch inside the window costs nothing, one
 *   outside it costs a billable request, and "we asked and there were none" is
 *   a cached answer like any other.
 *
 *   BRIEFINGS are the operator's, permanent, and append-only under a call.
 *   Nothing here updates one; regenerating writes a new row and the newest
 *   wins. The migration says why: keeping only the newest would erase the fact
 *   that the operator opened the call on a different argument.
 */

/**
 * How long a fetched review set is reused.
 *
 * Thirty days, the same window `search_results` holds Google content for, which
 * is the outer edge of Google's own caching guidance. It is stated twice — here
 * and as the column default — because the column default cannot be applied to an
 * upsert that takes the update path, and a cache that silently stopped expiring
 * would be a compliance failure rather than a performance one.
 */
const REVIEW_RETENTION_DAYS = 30

/* ------------------------------------------------------------------------- *
 * Reviews
 * ------------------------------------------------------------------------- */

interface ReviewRow {
  rating: number | null
  body: string | null
  published_at: string | null
  relative_age: string | null
}

export interface CachedReviews {
  fetchedAt: string
  items: BriefingReview[]
}

/**
 * The cached review set for a place, or null when there is not a live one.
 *
 * Null means "ask Google". An object with an empty `items` means "Google was
 * asked, recently, and this business has no reviews" — which is a real answer
 * and the reason `place_review_fetches` exists as its own table.
 */
export async function readCachedReviews(googlePlaceId: string): Promise<CachedReviews | null> {
  const supabase = createServiceClient()

  const { data: fetchRow, error } = await supabase
    .from('place_review_fetches')
    .select('google_place_id, fetched_at, review_count')
    .eq('google_place_id', googlePlaceId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) throw new Error(`Could not read the review cache: ${error.message}`)
  if (!fetchRow) return null

  // A fetch that found nothing has no rows to go and get, and asking for them
  // would be one round trip per prepare for exactly the businesses the cache was
  // added to protect.
  if (!fetchRow.review_count) return { fetchedAt: fetchRow.fetched_at, items: [] }

  const { data: rows, error: rowsError } = await supabase
    .from('place_reviews')
    .select('rating, body, published_at, relative_age')
    .eq('google_place_id', googlePlaceId)
    .order('review_rank', { ascending: true })

  if (rowsError) throw new Error(`Could not read cached reviews: ${rowsError.message}`)

  return {
    fetchedAt: fetchRow.fetched_at,
    items: ((rows ?? []) as ReviewRow[]).map((row) => ({
      rating: row.rating,
      body: row.body,
      relativeAge: row.relative_age,
      publishedAt: row.published_at,
    })),
  }
}

/**
 * Write a fetched review set, replacing whatever was there.
 *
 * Replace rather than merge: five reviews are Google's current five, and a merge
 * would accumulate reviews that have since been deleted or hidden into a set
 * that no longer matches what the owner sees on his own listing.
 *
 * The parent row is written first because the foreign key requires it, and it
 * carries the new timestamps immediately. A failure between the two statements
 * therefore leaves a fresh fetch row with stale children — so the delete and
 * insert are ordered to close that window as tightly as one round trip allows,
 * and the fetch row is rewritten with a dead expiry if the children fail.
 */
export async function writeReviews(
  googlePlaceId: string,
  reviews: ProviderReview[],
): Promise<CachedReviews> {
  const supabase = createServiceClient()

  const fetchedAt = new Date()
  const expiresAt = new Date(fetchedAt.getTime() + REVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const parent = {
    google_place_id: googlePlaceId,
    fetched_at: fetchedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    review_count: reviews.length,
  }

  const { error: parentError } = await supabase
    .from('place_review_fetches')
    .upsert(parent, { onConflict: 'google_place_id' })
  if (parentError) throw new Error(`Could not record the review fetch: ${parentError.message}`)

  try {
    const { error: deleteError } = await supabase
      .from('place_reviews')
      .delete()
      .eq('google_place_id', googlePlaceId)
    if (deleteError) throw new Error(`Could not clear the old reviews: ${deleteError.message}`)

    if (reviews.length) {
      const { error: insertError } = await supabase.from('place_reviews').insert(
        reviews.map((review, index) => ({
          google_place_id: googlePlaceId,
          provider_review_id: review.providerReviewId,
          review_rank: index,
          rating: review.rating,
          body: review.text,
          language_code: review.languageCode,
          published_at: review.publishedAt,
          relative_age: review.relativeAge,
          fetched_at: parent.fetched_at,
          expires_at: parent.expires_at,
        })),
      )
      if (insertError) throw new Error(`Could not store the reviews: ${insertError.message}`)
    }
  } catch (error) {
    /*
     * The parent is already claiming a fresh set that is not there. Delete it
     * rather than leave it: a fetch row with no children reads as "asked
     * recently, this business has no reviews", which is a claim the operator
     * might repeat on a call. Losing the cache entry costs one request; leaving
     * it costs the truth.
     */
    await supabase.from('place_review_fetches').delete().eq('google_place_id', googlePlaceId)
    throw error
  }

  return {
    fetchedAt: parent.fetched_at,
    items: reviews.map((review) => ({
      rating: review.rating,
      body: review.text,
      relativeAge: review.relativeAge,
      publishedAt: review.publishedAt,
    })),
  }
}

/* ------------------------------------------------------------------------- *
 * Calls
 * ------------------------------------------------------------------------- */

/**
 * Open a call attempt.
 *
 * `calls` records ATTEMPTS, not conversations — the migration is explicit — so
 * this row is written when the operator presses prepare, which is the moment he
 * has decided to ring. `ended_at` stays null, which is what "in progress" means
 * and what `calls_in_progress_idx` is for.
 *
 * `status_before` is stamped now rather than left for later. It is the whole
 * point of that column: `leads.status` is a moving target, and a call has to
 * stay readable months afterwards as the thing that moved it.
 */
export async function startCall(
  leadId: string,
  statusBefore: string,
): Promise<{ id: string; startedAt: string }> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('calls')
    .insert({ lead_id: leadId, status_before: statusBefore })
    .select('id, started_at')
    .single()

  if (error) throw new Error(`Could not open the call: ${error.message}`)
  return { id: data.id, startedAt: data.started_at }
}

/**
 * One call, as the assistant surface needs it.
 *
 * Deliberately not joined to the lead here. `readLead` already knows how to read
 * a lead and is the only place that should, and a second projection of the same
 * row is the thing that eventually disagrees with the first.
 */
export interface CallRow {
  id: string
  leadId: string
  startedAt: string
  endedAt: string | null
  consentNoted: boolean
  outcome: string | null
}

const CALL_COLUMNS = 'id, lead_id, started_at, ended_at, consent_noted, outcome'

interface RawCall {
  id: string
  lead_id: string
  started_at: string
  ended_at: string | null
  consent_noted: boolean
  outcome: string | null
}

function toCall(row: RawCall): CallRow {
  return {
    id: row.id,
    leadId: row.lead_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    consentNoted: row.consent_noted,
    outcome: row.outcome,
  }
}

export async function readCall(callId: string): Promise<CallRow | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('calls')
    .select(CALL_COLUMNS)
    .eq('id', callId)
    .maybeSingle()

  if (error) throw new Error(`Could not read the call: ${error.message}`)
  return data ? toCall(data as unknown as RawCall) : null
}

/** Finished attempts before this one, newest first. Feeds `BriefingHistory`. */
export async function readPreviousCalls(
  leadId: string,
  excludeCallId: string | null,
): Promise<{ endedAt: string | null; outcome: string | null }[]> {
  const supabase = createServiceClient()

  let query = supabase
    .from('calls')
    .select('id, ended_at, outcome')
    .eq('lead_id', leadId)
    .order('started_at', { ascending: false })
    .limit(20)

  if (excludeCallId) query = query.neq('id', excludeCallId)

  const { data, error } = await query
  if (error) throw new Error(`Could not read the call history: ${error.message}`)

  return ((data ?? []) as { ended_at: string | null; outcome: string | null }[]).map((row) => ({
    endedAt: row.ended_at,
    outcome: row.outcome,
  }))
}

/**
 * Mark the moment the line actually opened, and return the timeline's zero.
 *
 * THE ONE COLUMN THIS FILE REWRITES, and the reason is arithmetic rather than
 * taste. `startCall` stamps `started_at` when the operator presses Prepare —
 * the moment he decided to ring — and he then reads the briefing for a minute
 * before he dials. But `at_ms` is defined as milliseconds from `started_at`, so
 * leaving that stamp where prepare put it would file every segment of the call a
 * minute later than it was said, against a zero that is not the start of
 * anything. The migration's own words are that a call is a timeline of its own;
 * this is what makes that true.
 *
 * GUARDED TWICE, because rewriting a timestamp is not a thing to do casually.
 * A call with segments already stored has a timeline that other rows are
 * measured against, and moving its origin would silently shift all of them — so
 * the second press returns the existing zero and changes nothing. A closed call
 * refuses outright.
 */
export async function markListening(
  callId: string,
): Promise<{ startedAt: string; restamped: boolean }> {
  const supabase = createServiceClient()

  const call = await readCall(callId)
  if (!call) throw new Error('That call is not in the book.')
  if (call.endedAt) throw new Error('That call has already been closed off.')

  const { count, error: countError } = await supabase
    .from('call_transcript_segments')
    .select('id', { count: 'exact', head: true })
    .eq('call_id', callId)

  if (countError) throw new Error(`Could not check the transcript: ${countError.message}`)

  // Resuming after a reload or a second press. The zero is already load-bearing.
  if (count && count > 0) return { startedAt: call.startedAt, restamped: false }

  const startedAt = new Date().toISOString()
  const { error } = await supabase.from('calls').update({ started_at: startedAt }).eq('id', callId)
  if (error) throw new Error(`Could not open the line: ${error.message}`)

  return { startedAt, restamped: true }
}

/** Whether consent was stated, as the operator reports it. Never inferred. */
export async function setConsentNoted(callId: string, noted: boolean): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('calls')
    .update({ consent_noted: noted })
    .eq('id', callId)

  if (error) throw new Error(`Could not record the consent note: ${error.message}`)
}

/**
 * Close the attempt.
 *
 * `status_after` is deliberately not written here. The lead's status is moved on
 * the lead page, by the operator, after the call — and stamping it at hang-up
 * would record where the lead stood before he had decided anything.
 *
 * Idempotent by omission: a second stop on a closed call leaves the first
 * `ended_at` alone. The first one is when he stopped listening; the second is
 * usually a double-click or a reloaded tab.
 */
export async function endCall(callId: string, outcome: string | null): Promise<CallRow> {
  const supabase = createServiceClient()

  const call = await readCall(callId)
  if (!call) throw new Error('That call is not in the book.')

  const patch: Record<string, unknown> = {}
  if (!call.endedAt) patch.ended_at = new Date().toISOString()
  if (outcome !== null) patch.outcome = outcome

  if (!Object.keys(patch).length) return call

  const { data, error } = await supabase
    .from('calls')
    .update(patch)
    .eq('id', callId)
    .select(CALL_COLUMNS)
    .single()

  if (error) throw new Error(`Could not close the call: ${error.message}`)
  return toCall(data as unknown as RawCall)
}

/* ------------------------------------------------------------------------- *
 * Transcript segments
 * ------------------------------------------------------------------------- */

export async function readSegments(callId: string): Promise<TranscriptSegment[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('call_transcript_segments')
    .select('at_ms, speaker, text')
    .eq('call_id', callId)
    .order('at_ms', { ascending: true })

  if (error) throw new Error(`Could not read the transcript: ${error.message}`)

  return ((data ?? []) as { at_ms: number; speaker: Speaker; text: string }[]).map((row) => ({
    atMs: row.at_ms,
    speaker: row.speaker,
    text: row.text,
  }))
}

/**
 * Append recognised speech. Called every few seconds, all call long.
 *
 * WRITTEN DURING THE CALL RATHER THAN AT THE END OF IT, which is the only
 * decision here. A transcript held in a tab until hang-up is a transcript that a
 * crashed browser, a closed laptop or a misjudged reload destroys completely —
 * and it is destroyed at the moment it is most valuable, because the call it
 * recorded is the one that just went well. The cost is a small insert every few
 * seconds against a table that expires in fourteen days.
 *
 * `expires_at` is left to the column default on purpose. The retention window
 * belongs to the schema, and a caller that could set it is a caller that could
 * quietly extend it.
 */
export async function appendSegments(
  callId: string,
  segments: readonly TranscriptSegment[],
): Promise<number> {
  if (!segments.length) return 0

  const supabase = createServiceClient()

  const { error } = await supabase.from('call_transcript_segments').insert(
    segments.map((segment) => ({
      call_id: callId,
      at_ms: segment.atMs,
      speaker: segment.speaker,
      text: segment.text,
    })),
  )

  if (error) throw new Error(`Could not save the transcript: ${error.message}`)
  return segments.length
}

/* ------------------------------------------------------------------------- *
 * Tips
 * ------------------------------------------------------------------------- */

export interface StoredTip {
  id: number
  atMs: number
  trigger: string
  body: string
  shown: boolean
  actedOn: boolean
}

export interface TipWrite {
  callId: string
  atMs: number
  trigger: string
  body: string
  /** Did it reach the screen. Written by the app, never by whatever produced it. */
  shown: boolean
}

/**
 * Record that the assistant said something, and return the row it went into.
 *
 * The id comes back because `acted_on` is written later, by a keypress, and the
 * surface needs a handle on the row to write it to. Everything else about a tip
 * is settled the moment it appears.
 *
 * NOT ON THE CALL'S CRITICAL PATH, and callers are expected to treat it that
 * way. A tip that reached the screen has already done its job; a failed insert
 * costs a row in an analysis that happens months later, and there is nothing
 * about it worth interrupting a phone call to report. The rule the migration
 * states holds on the way in: `body` must not quote the call, because this table
 * outlives the fourteen-day transcript and a quoted sentence would outlive it
 * too. Both sources satisfy it by construction — the briefing was written before
 * the call, and the standing lines are in the vocabulary.
 */
export async function writeTip(write: TipWrite): Promise<number> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('call_tips')
    .insert({
      call_id: write.callId,
      at_ms: write.atMs,
      trigger: write.trigger,
      body: write.body,
      shown: write.shown,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not record the tip: ${error.message}`)
  return (data as { id: number }).id
}

/**
 * The operator's own verdict on one tip.
 *
 * The column this whole table is eventually for. `shown` says the assistant
 * spoke and `acted_on` says it was worth speaking, and only the second one can
 * answer whether any of this helps — which is the same question
 * `insight/outcomes.ts` asks of finding codes, and it will be asked the same
 * way once there are enough calls to ask it of.
 *
 * One-way on purpose: there is no un-mark. A tip he used is a fact about a
 * conversation that has since ended.
 *
 * Scoped by call as well as by id. The id comes back from the browser, and a
 * route that updated on it alone would let a stale tab mark a row belonging to
 * a different conversation — cheap to prevent, and the kind of thing that is
 * only ever noticed a year later as a call whose tips do not add up.
 */
export async function markTipActedOn(callId: string, id: number): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('call_tips')
    .update({ acted_on: true })
    .eq('id', id)
    .eq('call_id', callId)

  if (error) throw new Error(`Could not mark the tip as used: ${error.message}`)
}

/** Every tip offered in one call, oldest first. */
export async function readTips(callId: string): Promise<StoredTip[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('call_tips')
    .select('id, at_ms, trigger, body, shown, acted_on')
    .eq('call_id', callId)
    .order('at_ms', { ascending: true })

  if (error) throw new Error(`Could not read the tips: ${error.message}`)

  return (
    (data ?? []) as {
      id: number
      at_ms: number
      trigger: string
      body: string
      shown: boolean
      acted_on: boolean
    }[]
  ).map((row) => ({
    id: row.id,
    atMs: row.at_ms,
    trigger: row.trigger,
    body: row.body,
    shown: row.shown,
    actedOn: row.acted_on,
  }))
}

/* ------------------------------------------------------------------------- *
 * Briefings
 * ------------------------------------------------------------------------- */

interface BriefingRow {
  id: string
  call_id: string
  generated_at: string
  provider: string
  model: string | null
  content: unknown
}

const BRIEFING_COLUMNS = 'id, call_id, generated_at, provider, model, content'

/**
 * A stored jsonb blob, read back as a briefing — or not read back at all.
 *
 * A row written under an older shape returns null rather than a half-populated
 * object. The surface then renders as though there were no briefing, which is
 * true in the only sense that matters: there is nothing here the operator can
 * read aloud. The same choice `compareScores` makes when a breakdown is too old
 * to interpret, and the reason `content` is jsonb in the first place.
 */
function toBriefing(value: unknown): Briefing | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Briefing>
  if (typeof candidate.opening !== 'string' || !Array.isArray(candidate.points)) return null
  if (!candidate.origin || typeof candidate.origin !== 'object') return null

  return {
    origin: candidate.origin,
    headline: candidate.headline ?? '',
    opening: candidate.opening,
    points: candidate.points,
    objections: candidate.objections ?? [],
    ask: candidate.ask ?? '',
    avoid: candidate.avoid ?? [],
  }
}

interface StoredMeta {
  diagnosisAsOf: string | null
  reviewCount: number | null
}

/**
 * The two facts about a briefing that are not in the briefing.
 *
 * Read back out of the stored `content` rather than given columns of their own.
 * `call_briefings` is a finished migration and its shape is deliberate — content
 * is jsonb precisely so the assistant's output can carry what it needs without a
 * schema change — so the age of the diagnosis rides inside the row this app
 * wrote rather than beside it.
 */
function metaOf(value: unknown): StoredMeta {
  const source = (value ?? {}) as Record<string, unknown>
  const meta = (source.leadEngineMeta ?? {}) as Record<string, unknown>
  return {
    diagnosisAsOf: typeof meta.diagnosisAsOf === 'string' ? meta.diagnosisAsOf : null,
    reviewCount: typeof meta.reviewCount === 'number' ? meta.reviewCount : null,
  }
}

function toStored(row: BriefingRow, lastAuditedAt: string | null): StoredBriefing | null {
  const briefing = toBriefing(row.content)
  if (!briefing) return null

  const meta = metaOf(row.content)

  return {
    id: row.id,
    callId: row.call_id,
    generatedAt: row.generated_at,
    provider: row.provider,
    model: row.model,
    briefing,
    diagnosisAsOf: meta.diagnosisAsOf,
    reviewCount: meta.reviewCount,
    stale:
      lastAuditedAt !== null && meta.diagnosisAsOf !== null && meta.diagnosisAsOf < lastAuditedAt,
  }
}

/**
 * The newest briefing on the lead's newest call.
 *
 * Reached through `leads.latest_call_id`, which the trigger keeps pointing at
 * the most recent attempt including one in progress — so the lead being rung
 * right now is the lead whose briefing this returns.
 */
export async function readLatestBriefing(
  latestCallId: string | null,
  lastAuditedAt: string | null,
): Promise<StoredBriefing | null> {
  if (!latestCallId) return null

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('call_briefings')
    .select(BRIEFING_COLUMNS)
    .eq('call_id', latestCallId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not read the briefing: ${error.message}`)
  if (!data) return null

  return toStored(data as unknown as BriefingRow, lastAuditedAt)
}

export interface BriefingWrite {
  callId: string
  provider: string
  model: string | null
  briefing: Briefing
  diagnosisAsOf: string | null
  reviewCount: number | null
}

export async function writeBriefing(write: BriefingWrite): Promise<StoredBriefing> {
  const supabase = createServiceClient()

  /*
   * The provenance the assistant stamped, plus the two ages only this app knows.
   * Stored under one namespaced key rather than merged into the briefing's own
   * fields, so nothing here can be mistaken for something a provider said.
   */
  const content = {
    ...write.briefing,
    leadEngineMeta: {
      diagnosisAsOf: write.diagnosisAsOf,
      reviewCount: write.reviewCount,
    },
  }

  const { data, error } = await supabase
    .from('call_briefings')
    .insert({
      call_id: write.callId,
      provider: write.provider,
      model: write.model,
      content,
    })
    .select(BRIEFING_COLUMNS)
    .single()

  if (error) throw new Error(`Could not save the briefing: ${error.message}`)

  // Freshly written against the audit it was built from, so it cannot be stale.
  const stored = toStored(data as unknown as BriefingRow, write.diagnosisAsOf)
  if (!stored) throw new Error('The briefing was saved but could not be read back.')
  return stored
}
