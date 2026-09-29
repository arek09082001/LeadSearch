import {
  CHANGE_THRESHOLDS,
  type ChangeCode,
} from '@/lib/leads/changes'

/*
 * What moved between two Google snapshots.
 *
 * Pure, for the same reason `findings.ts` and `score.ts` are pure: no network,
 * no database, no clock. Everything it needs is the two snapshots, so the rule
 * for "did anything change" can be argued with in one place and re-run over
 * stored rows without asking Google anything a second time.
 *
 * The comparisons are deliberately conservative. A refresh that reports a change
 * every month is a refresh the operator stops reading, and the whole value of
 * this pass is that a mark on a row means something happened. So:
 *
 *   - Websites are compared as URLs, not as strings. Google returns
 *     `http://x.de` one month and `https://www.x.de/` the next for the same
 *     site, and calling that "they moved their website" is noise.
 *   - Numbers have a floor under them. Review counts drift by one as Google
 *     re-indexes; three is the smallest movement that is about customers rather
 *     than about Google.
 *   - Names are compared with whitespace and case folded, so a capitalisation
 *     fix in the listing is not a rebrand.
 */

/** The volatile Google fields, and only those. Everything else is the operator's. */
export interface Snapshot {
  name: string | null
  website: string | null
  phone: string | null
  rating: number | null
  reviews: number | null
  businessStatus: string | null
}

export interface Delta {
  codes: ChangeCode[]
  before: Snapshot
  after: Snapshot
}

const CLOSED = 'CLOSED_PERMANENTLY'

/**
 * A URL reduced to the site it names.
 *
 * Scheme, `www.`, a trailing slash and the case of the host all vary between
 * Google's own responses for an unchanged site. The path is kept, lowercased
 * host and all, because a business moving from a shared page to its own path is
 * a real move.
 */
function sameSite(a: string | null, b: string | null): boolean {
  if (a === b) return true
  if (!a || !b) return false

  const key = (value: string): string | null => {
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`)
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      const path = url.pathname.replace(/\/+$/, '')
      return `${host}${path}`
    } catch {
      return value.trim().toLowerCase().replace(/\/+$/, '')
    }
  }

  const left = key(a)
  const right = key(b)
  return left !== null && left === right
}

/** Digits only. `+49 7131 12345` and `07131 12345` are the same number to dial. */
function samePhone(a: string | null, b: string | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const digits = (value: string) => value.replace(/\D/g, '').replace(/^0+/, '')
  return digits(a) === digits(b) && digits(a) !== ''
}

function sameName(a: string | null, b: string | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Compare two snapshots and name what moved.
 *
 * An empty `codes` is the ordinary result and the one the caller must handle
 * first: most businesses do not change between two look-ups, and nothing is
 * written down when nothing happened.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): Delta {
  const codes: ChangeCode[] = []

  /*
   * The website, first and on its own, because it is the product.
   *
   * A lead is in the book because it had no website or a bad one. "They now
   * have one" is the single fact that most changes what he should do about it,
   * and it is the reason this pass exists at all.
   */
  const had = Boolean(before.website)
  const has = Boolean(after.website)
  if (!had && has) codes.push('website_appeared')
  else if (had && !has) codes.push('website_gone')
  else if (had && has && !sameSite(before.website, after.website)) codes.push('website_changed')

  const reviewsBefore = before.reviews ?? 0
  const reviewsAfter = after.reviews ?? 0
  const reviewDelta = reviewsAfter - reviewsBefore
  if (Math.abs(reviewDelta) >= CHANGE_THRESHOLDS.minReviewDelta) {
    codes.push(reviewDelta > 0 ? 'reviews_up' : 'reviews_down')
  }

  /*
   * A rating only moves if there was one to move. A business acquiring its
   * first rating is already being reported as `reviews_up`, and reporting it
   * twice would put two marks on a row for one event.
   */
  if (before.rating !== null && after.rating !== null) {
    const ratingDelta = after.rating - before.rating
    // Ratings are numeric(2,1), so the comparison is against a tenth with a
    // hair of tolerance for the float that carried it here.
    if (Math.abs(ratingDelta) >= CHANGE_THRESHOLDS.minRatingDelta - 0.001) {
      codes.push(ratingDelta > 0 ? 'rating_up' : 'rating_down')
    }
  }

  if (!samePhone(before.phone, after.phone) && (before.phone || after.phone)) {
    codes.push('phone_changed')
  }

  if (!sameName(before.name, after.name) && after.name) {
    codes.push('name_changed')
  }

  const wasClosed = before.businessStatus === CLOSED
  const isClosed = after.businessStatus === CLOSED
  if (!wasClosed && isClosed) codes.push('closed')
  else if (wasClosed && !isClosed) codes.push('reopened')

  return { codes, before, after }
}

/**
 * The change set for a business Google no longer lists.
 *
 * Its own outcome rather than a diff, because there is no "after" to compare
 * against: a 404 from Place Details means the place ID has been retired or
 * merged, and every field on file is now unverifiable rather than wrong. The
 * snapshot is deliberately left exactly as it is — this is the operator's last
 * good record of a business he may still want to phone.
 */
export function delisted(before: Snapshot): Delta {
  return { codes: ['delisted'], before, after: before }
}

/** One line of English per change, with the numbers in it. What the history reads. */
export function describeDelta(delta: Delta): string {
  const { before, after } = delta
  const said: string[] = []

  for (const code of delta.codes) {
    switch (code) {
      case 'website_appeared':
        said.push(`Built a website — ${host(after.website)}`)
        break
      case 'website_gone':
        said.push(`The website on file (${host(before.website)}) is no longer listed`)
        break
      case 'website_changed':
        said.push(`Website moved from ${host(before.website)} to ${host(after.website)}`)
        break
      case 'reviews_up':
      case 'reviews_down':
        said.push(`Reviews ${before.reviews ?? 0} → ${after.reviews ?? 0}`)
        break
      case 'rating_up':
      case 'rating_down':
        said.push(`Rating ${before.rating ?? '—'} → ${after.rating ?? '—'}`)
        break
      case 'phone_changed':
        said.push(`Phone ${before.phone ?? 'none'} → ${after.phone ?? 'none'}`)
        break
      case 'name_changed':
        said.push(`Renamed from “${before.name ?? '—'}” to “${after.name ?? '—'}”`)
        break
      case 'closed':
        said.push('Google now marks this business permanently closed')
        break
      case 'reopened':
        said.push('Google no longer marks this business closed')
        break
      case 'delisted':
        said.push('Google no longer has a listing under this place ID')
        break
    }
  }

  return said.join('. ')
}

function host(url: string | null): string {
  if (!url) return 'none'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
