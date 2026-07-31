import type { SearchRow } from '@/lib/search/types'

/*
 * The order the feed is drawn in.
 *
 * Lifted out of the table it started in, because the ORDER is no longer the
 * table's private business: the feed is now shared state (see
 * `components/search/feed-store`), two surfaces draw it, and a range selection
 * is "the rows between these two AS DRAWN". If the map's rail and the search
 * table each held their own sort, the same tick gesture would mean different
 * rows on the two surfaces and a run taken on one would look scrambled on the
 * other.
 *
 * Nothing here touches the DOM or the server, so both the store and the table
 * can import it without either dragging the other along.
 */

export type SortKey = 'rank' | 'name' | 'rating' | 'reviews' | 'web'

export interface SortState {
  key: SortKey
  desc: boolean
}

/** Google's own order, which is the order the operator asked for. */
export const RANK_SORT: SortState = { key: 'rank', desc: false }

/** What each key is called wherever a sort is picked from a list rather than a header. */
export const SORT_LABELS: Record<SortKey, string> = {
  rank: 'Rank',
  name: 'Name',
  rating: 'Rating',
  reviews: 'Reviews',
  web: 'No site first',
}

/** Numeric columns sort high-to-low first; text sorts A-to-Z first. */
const DESC_FIRST = new Set<SortKey>(['rating', 'reviews'])

/**
 * The rows in the order they are drawn.
 *
 * A copy, always: the store holds the rows in arrival order because that is
 * what `rank` means, and a sort that mutated them would quietly destroy the
 * one ordering the operator did not choose.
 */
export function sortRows(rows: SearchRow[], sort: SortState): SearchRow[] {
  const copy = rows.map((row, index) => ({ row, index }))
  const direction = sort.desc ? -1 : 1

  copy.sort((a, b) => {
    switch (sort.key) {
      case 'name':
        return direction * (a.row.name ?? '').localeCompare(b.row.name ?? '', 'de')
      case 'rating':
        // No rating is not a zero rating; unrated businesses sink either way
        // rather than pretending to be the worst-reviewed in town.
        return direction * ((a.row.rating ?? -1) - (b.row.rating ?? -1))
      case 'reviews':
        return direction * ((a.row.userRatingCount ?? -1) - (b.row.userRatingCount ?? -1))
      case 'web':
        // The one sort the product exists for: no-website first.
        return direction * (Number(Boolean(a.row.website)) - Number(Boolean(b.row.website)))
      default:
        return direction * (a.index - b.index)
    }
  })

  return copy.map((entry) => entry.row)
}

/** Clicking the active column flips it; a new one starts where it is useful. */
export function nextSort(prev: SortState, key: SortKey): SortState {
  if (prev.key === key) return { key, desc: !prev.desc }
  return { key, desc: DESC_FIRST.has(key) }
}
