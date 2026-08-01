import 'server-only'

import {
  ProviderError,
  type CostEvent,
  type ProviderContext,
  type ProviderReview,
  type ReviewProvider,
  type ReviewsResult,
} from '@/lib/providers/types'
import {
  REVIEWS_FIELD_MASK,
  REVIEWS_TIER,
  skuId,
  skuLabel,
  unitPriceUsd,
} from '@/lib/providers/google-places/skus'

/*
 * Google Places reviews — a separate call, on purpose, and the reason is money.
 *
 * `reviews` is an Enterprise + Atmosphere field. Places prices a request at the
 * most expensive field in its mask, so putting it into `DETAILS_FIELD_MASK`
 * would move every Place Details call this product makes — one per lead at save
 * time, one per lead on every nightly refresh — into the top band, and would
 * spend the 1,000-call monthly allowance on the nine hundred and sixty leads
 * that never get phoned.
 *
 * This module is called once, from the call briefing, for the one business the
 * operator is about to ring. Same key, same ledger, different question.
 *
 * FIVE. Google returns at most five reviews and offers no pagination, which is
 * a fact about Google rather than a decision made here — `maxReviews` states it
 * so that a fuller source can be dropped in beside this one later and nothing
 * above the boundary has to learn a new number.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1'

/** Google's own ceiling on a single Place Details response. Not ours. */
const MAX_REVIEWS = 5

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    throw new ProviderError(
      'reviews',
      'Missing GOOGLE_PLACES_API_KEY. Add it to .env.local — see .env.example.',
    )
  }
  return key
}

/* ------------------------------------------------------------------------- *
 * Response shape — only the parts we read.
 * ------------------------------------------------------------------------- */

interface GoogleLocalizedText {
  text?: string
  languageCode?: string
}

interface GoogleReview {
  name?: string
  rating?: number
  text?: GoogleLocalizedText
  /** The review before Google translated it. Preferred; see `pickText`. */
  originalText?: GoogleLocalizedText
  publishTime?: string
  relativePublishTimeDescription?: string
  /*
   * `authorAttribution` is present in every response and is deliberately not
   * declared here. A shape that does not name it cannot accidentally carry it
   * into a row, a jsonb blob or a model prompt.
   */
}

interface ReviewsResponse {
  id?: string
  reviews?: GoogleReview[]
}

/**
 * The words the customer actually typed, not Google's translation of them.
 *
 * Google translates a review into the request's language and returns the
 * translation in `text`, with the original in `originalText`. The operator is
 * ringing a German business about German reviews, so the translation is a
 * round trip that can only lose something. `text` is the fallback because
 * `originalText` is absent when no translation happened at all.
 */
function pickText(review: GoogleReview): GoogleLocalizedText | null {
  const original = review.originalText?.text?.trim()
  if (original) return review.originalText!
  const translated = review.text?.text?.trim()
  if (translated) return review.text!
  return null
}

function normalize(review: GoogleReview): ProviderReview {
  const body = pickText(review)
  return {
    providerReviewId: review.name ?? '',
    rating: typeof review.rating === 'number' ? review.rating : null,
    text: body?.text?.trim() || null,
    languageCode: body?.languageCode ?? null,
    publishedAt: review.publishTime ?? null,
    relativeAge: review.relativePublishTimeDescription ?? null,
  }
}

/* ------------------------------------------------------------------------- *
 * The provider
 * ------------------------------------------------------------------------- */

export class GooglePlacesReviewProvider implements ReviewProvider {
  readonly id = 'google_places'
  readonly label = 'Google Places'
  readonly maxReviews = MAX_REVIEWS

  async getReviews(providerPlaceId: string, ctx?: ProviderContext): Promise<ReviewsResult> {
    const price = unitPriceUsd('place_details', REVIEWS_TIER)
    const event: CostEvent = {
      sku: skuId('place_details', REVIEWS_TIER),
      label: skuLabel('place_details', REVIEWS_TIER),
      units: 1,
      unitPriceUsd: price,
      listAmountUsd: price,
    }

    // Ask, spend, record — and record even when the request throws, because
    // Google bills a 500 exactly like a 200. The one exception is a refusal
    // from the guard: nothing was sent, so nothing is recorded.
    await ctx?.authorizeSpend?.(event)

    let body: ReviewsResponse
    try {
      const res = await fetch(
        `${PLACES_BASE}/places/${encodeURIComponent(providerPlaceId)}`,
        {
          cache: 'no-store',
          signal: ctx?.signal,
          headers: {
            'X-Goog-Api-Key': apiKey(),
            'X-Goog-FieldMask': REVIEWS_FIELD_MASK.join(','),
          },
        },
      )
      if (!res.ok) {
        throw new ProviderError('reviews', await errorMessage(res), res.status)
      }
      body = (await res.json()) as ReviewsResponse
    } finally {
      await ctx?.recordSpend?.(event)
    }

    const reviews = (body.reviews ?? [])
      .map(normalize)
      .filter((review) => Boolean(review.providerReviewId))
      .slice(0, MAX_REVIEWS)

    return { reviews, cost: [event] }
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    const message = body.error?.message
    if (message) return `Google Places: ${message} (HTTP ${res.status})`
  } catch {
    // Fall through to the status line.
  }
  return `Google Places returned HTTP ${res.status}.`
}
