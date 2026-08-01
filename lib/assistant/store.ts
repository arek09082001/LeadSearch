import 'server-only'

import type { Briefing, BriefingInput, BriefingReview, StoredBriefing } from '@/lib/assistant/types'
import type { ProviderReview } from '@/lib/providers/types'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * The half that knows column names.
 *
 * `briefing-input.ts` is pure and `mock.ts` is pure; everything that touches
 * Postgres is here, which is the same split `scoring/score.ts` and
 * `scoring/store.ts` draw and for the same reason — the arithmetic has to be
 * readable without a database in the room.
 *
 * Two caches live in this file and they are not the same kind of thing:
 *
 *   REVIEWS are Google's, transient, and expire on a clock the database
 *   enforces. Read-through: a fetch inside the window costs nothing, one
 *   outside it costs a billable request, and "we asked and there were none" is
 *   a cached answer like any other.
 *
 *   BRIEFINGS are the operator's, permanent, and append-only. Nothing here
 *   updates one; a re-prepare writes a new row and the newest wins. The old
 *   ones are the record of what was said, which is worth more than the disk.
 */

/**
 * How long a fetched review set is reused.
 *
 * Thirty days, the same window `search_results` holds Google content for, which
 * is the outer edge of Google's own caching guidance. It is stated twice — here
 * and as the column default — because the column default cannot be applied to
 * an upsert that takes the update path, and a cache that silently stopped
 * expiring would be a compliance failure rather than a performance one.
 */
const REVIEW_RETENTION_DAYS = 30

/* ------------------------------------------------------------------------- *
 * Reviews
 * ------------------------------------------------------------------------- */

interface ReviewRow {
  rating: number | null
  body: string | null
  language_code: string | null
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
  // would be one round trip per prepare for exactly the businesses the cache
  // was added to protect.
  if (!fetchRow.review_count) return { fetchedAt: fetchRow.fetched_at, items: [] }

  const { data: rows, error: rowsError } = await supabase
    .from('place_reviews')
    .select('rating, body, language_code, published_at, relative_age')
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
      languageCode: row.language_code,
    })),
  }
}

/**
 * Write a fetched review set, replacing whatever was there.
 *
 * Replace rather than merge: five reviews are Google's current five, and a
 * merge would accumulate reviews that have since been deleted or hidden into a
 * set that no longer matches what the owner sees on their own listing. The
 * parent row is written LAST, so a failure halfway through leaves no fetch row
 * claiming a set that was not stored — the next prepare simply asks again.
 */
export async function writeReviews(
  googlePlaceId: string,
  reviews: ProviderReview[],
): Promise<CachedReviews> {
  const supabase = createServiceClient()

  const fetchedAt = new Date()
  const expiresAt = new Date(fetchedAt.getTime() + REVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  /*
   * The parent has to exist before its children can reference it, and it has to
   * be written again afterwards to move the clock. Two statements rather than
   * one: the first satisfies the foreign key, the second is what makes the
   * cache fresh, and doing them in that order means an interrupted write leaves
   * a fetch row with the OLD timestamps on it, which expires and re-asks.
   */
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

  return {
    fetchedAt: parent.fetched_at,
    items: reviews.map((review) => ({
      rating: review.rating,
      body: review.text,
      relativeAge: review.relativeAge,
      publishedAt: review.publishedAt,
      languageCode: review.languageCode,
    })),
  }
}

/* ------------------------------------------------------------------------- *
 * Briefings
 * ------------------------------------------------------------------------- */

interface BriefingRow {
  id: string
  created_at: string
  provider: string
  model: string | null
  briefing: unknown
  diagnosis_as_of: string | null
  google_as_of: string | null
  reviews_as_of: string | null
  review_count: number
}

const BRIEFING_COLUMNS =
  'id, created_at, provider, model, briefing, diagnosis_as_of, google_as_of, reviews_as_of, review_count'

/**
 * A stored jsonb blob, read back as a briefing — or not read back at all.
 *
 * A row written under an older shape returns null rather than a half-populated
 * object. The surface then renders as though there were no briefing, which is
 * true in the only sense that matters: there is nothing here the operator can
 * read aloud. The same choice `compareScores` makes when a breakdown is too old
 * to interpret.
 */
function toBriefing(value: unknown): Briefing | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Briefing>
  if (!Array.isArray(candidate.opener) || !Array.isArray(candidate.hooks)) return null

  return {
    opener: candidate.opener,
    hooks: candidate.hooks,
    evidence: candidate.evidence ?? [],
    objections: candidate.objections ?? [],
    avoid: candidate.avoid ?? [],
  }
}

function toStored(row: BriefingRow, lastAuditedAt: string | null): StoredBriefing | null {
  const briefing = toBriefing(row.briefing)
  if (!briefing) return null

  return {
    id: row.id,
    createdAt: row.created_at,
    provider: row.provider,
    model: row.model,
    briefing,
    diagnosisAsOf: row.diagnosis_as_of,
    googleAsOf: row.google_as_of,
    reviewsAsOf: row.reviews_as_of,
    reviewCount: row.review_count,
    /*
     * Two stored timestamps compared, never a clock. The lead has been audited
     * since this was written, so the faults it opens with may not be the faults
     * any more — the same failure the diagnosis page guards against, one level
     * up and with a phone in the operator's hand.
     */
    stale:
      lastAuditedAt !== null &&
      row.diagnosis_as_of !== null &&
      row.diagnosis_as_of < lastAuditedAt,
  }
}

export async function readLatestBriefing(
  leadId: string,
  lastAuditedAt: string | null,
): Promise<StoredBriefing | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('call_briefings')
    .select(BRIEFING_COLUMNS)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not read the briefing: ${error.message}`)
  if (!data) return null

  return toStored(data as unknown as BriefingRow, lastAuditedAt)
}

export interface BriefingWrite {
  leadId: string
  auditId: string | null
  scoreId: string | null
  provider: string
  model: string | null
  input: BriefingInput
  briefing: Briefing
}

export async function writeBriefing(write: BriefingWrite): Promise<StoredBriefing> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('call_briefings')
    .insert({
      lead_id: write.leadId,
      audit_id: write.auditId,
      score_id: write.scoreId,
      provider: write.provider,
      model: write.model,
      input: write.input,
      briefing: write.briefing,
      diagnosis_as_of: write.input.asOf.diagnosis,
      google_as_of: write.input.asOf.google,
      reviews_as_of: write.input.asOf.reviews,
      review_count: write.input.reviews.length,
    })
    .select(BRIEFING_COLUMNS)
    .single()

  if (error) throw new Error(`Could not save the briefing: ${error.message}`)

  // Freshly written against the audit it was built from, so it cannot be stale.
  const stored = toStored(data as unknown as BriefingRow, write.input.asOf.diagnosis)
  if (!stored) throw new Error('The briefing was saved but could not be read back.')
  return stored
}
