'use client'

import { create } from 'zustand'

import type { SaveResultItem } from '@/lib/leads/types'
import { RANK_SORT, type SortState } from '@/lib/search/sort'
import type { BudgetState, SearchEvent, SearchInput, SearchRow } from '@/lib/search/types'

/*
 * THE FEED. One of them, for the whole session.
 *
 * This reads the NDJSON search stream and keeps whatever is drawing it in step.
 * Rows are appended per page rather than replaced at the end, because the point
 * of the stream is that the operator starts reading page one while page three
 * is still in flight.
 *
 * It is a store outside React rather than state inside a console, and that is
 * the whole of this file's reason to exist.
 *
 * A search costs money. It is the only thing in this product that does. Holding
 * the rows in `useState` inside `SearchConsole` and a second copy inside
 * `MapConsole` meant every move between the two threw away results the operator
 * had just paid Google for, and the only way back was to pay again or hope the
 * replay cache still held them. That is not a state-management preference, it
 * is a hole in the receipt.
 *
 * So the feed lives here: one set of rows, one selection, one order, one
 * ceiling. `/search` draws it as a full table, `/map` draws it as green marks
 * and a rail beside the field, and moving between them is a change of drawing
 * rather than a change of data — which is exactly what this product already
 * claims about the book on `/leads` and `/map`. The feed simply had no
 * equivalent until now.
 *
 * Why a module store and not a context in the app layout: Next preserves page
 * state across navigations only with Cache Components enabled (see
 * `next/dist/docs/01-app/02-guides/preserving-ui-state.md`), which this app does
 * not turn on — and until it does, the documented alternatives are a shared
 * layout or an external store. A layout context would work and would re-render
 * every consumer on every page of a streaming search; a store with selectors
 * does not, and needs no provider threaded through two server components to
 * reach the two clients that want it.
 *
 * It is deliberately memory-only. These rows are transient Google data with an
 * age stamped on them; persisting them into storage would resurrect a feed
 * older than the session it is drawn in, and Principle 5 would then be a
 * promise this store quietly breaks. A reload is a new session, and an
 * identical search replays from the server cache for nothing anyway.
 */

export type SearchStatus = 'idle' | 'running' | 'done' | 'blocked' | 'error'

/** Which surface bought these rows. Stated wherever they are drawn afterwards. */
export type FeedOrigin = 'search' | 'map'

export interface FeedState {
  status: SearchStatus
  rows: SearchRow[]
  /** Billed cost of the run in progress or just finished. */
  searchCostUsd: number
  requests: number
  budget: BudgetState | null
  /** Set when this result set was replayed from an earlier search for nothing. */
  cachedAt: string | null
  error: string | null
  /** Why the run stopped short, when the ceiling stopped it. */
  blocked: string | null
  /** What the run was quoted at before it began. */
  estimateUsd: number | null
  estimateLabel: string | null
  resolvedAddress: string | null
  /** Recorded on the lead as where it was discovered, when it is saved. */
  searchId: string | null

  /*
   * The question these rows answer, and where it was asked.
   *
   * Kept because the rows now outlive the surface that bought them: a table on
   * `/search` full of results fetched from a point on the map has to be able to
   * say so, or it reads as a search the operator does not remember running.
   */
  input: SearchInput | null
  origin: FeedOrigin | null

  /*
   * The decisions taken about the rows, which travel with them.
   *
   * A tick is a decision to save; the order is what a range of ticks is
   * measured in. Leaving either behind on the surface it was made on would mean
   * taking eleven rows on the map, opening the table to check them, and finding
   * nothing selected.
   */
  selected: Set<string>
  sort: SortState
}

export interface FeedActions {
  run: (input: SearchInput, origin: FeedOrigin) => Promise<void>
  cancel: () => void
  setBudget: (budget: BudgetState) => void
  /** The ledger a server render has just read, which is newer than ours. */
  hydrateBudget: (budget: BudgetState | null) => void
  markSaved: (items: SaveResultItem[]) => void
  setSelected: (next: Set<string>) => void
  setSort: (next: SortState) => void
}

interface FeedStore extends FeedState {
  /*
   * Nested rather than spread across the top level so that `useFeedActions`
   * can hand back one object that never changes identity. A component that
   * only acts on the feed then never re-renders because the feed moved.
   */
  actions: FeedActions
}

const INITIAL: FeedState = {
  status: 'idle',
  rows: [],
  searchId: null,
  searchCostUsd: 0,
  requests: 0,
  budget: null,
  cachedAt: null,
  error: null,
  blocked: null,
  estimateUsd: null,
  estimateLabel: null,
  resolvedAddress: null,
  input: null,
  origin: null,
  selected: new Set<string>(),
  sort: RANK_SORT,
}

/*
 * The reader for the run in flight, held outside the store on purpose.
 *
 * It is not state — nothing draws it, and putting an AbortController in the
 * store would re-render every subscriber to record a fact none of them show.
 * It is at module scope rather than in a component ref because a run now
 * outlives the surface that started it: a search begun on the map keeps
 * arriving while the operator walks over to the table, and `cancel` pressed
 * there has to reach the same controller.
 */
let inFlight: AbortController | null = null

export const useFeed = create<FeedStore>((set, get) => ({
  ...INITIAL,

  actions: {
    run: async (input, origin) => {
      // A second search replaces the first rather than racing it.
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller

      /*
       * A new result set invalidates the old ticks. Carrying them across two
       * searches would let the operator save businesses he can no longer see —
       * and now that ticks survive a navigation, this is the one place left
       * that is allowed to drop them.
       *
       * The ceiling and the chosen order survive: neither is an answer, and
       * re-picking "no site first" after every search would be a tax on the
       * one sort this product exists for.
       */
      set({ ...INITIAL, budget: get().budget, sort: get().sort, status: 'running', input, origin })

      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          const message = await response
            .json()
            .then((body: { error?: string }) => body.error)
            .catch(() => null)
          set({
            status: 'error',
            error: message ?? `The search request failed (HTTP ${response.status}).`,
          })
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // NDJSON: a chunk can split a line, and a chunk can hold several.
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          let newline: number
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (line) set(reduce(get(), JSON.parse(line) as SearchEvent))
          }
        }

        set((prev) => (prev.status === 'running' ? { status: 'done' } : {}))
      } catch (error) {
        // An abort is the operator changing their mind, not a failure.
        if (controller.signal.aborted) return
        set({
          status: 'error',
          error: error instanceof Error ? error.message : 'The search could not be reached.',
        })
      } finally {
        if (inFlight === controller) inFlight = null
      }
    },

    cancel: () => {
      inFlight?.abort()
      inFlight = null
      set((prev) => (prev.status === 'running' ? { status: 'done' } : {}))
    },

    setBudget: (budget) => set({ budget }),

    /*
     * Both surfaces read the ledger on the server and hand it down. The page
     * that mounted most recently read it most recently, so it wins — except
     * while a run is in flight, where the `cost` events coming off the stream
     * are newer than anything a page render knows and must not be stepped on.
     */
    hydrateBudget: (budget) => {
      if (!budget) return
      set((prev) => (prev.status === 'running' ? {} : { budget }))
    },

    /*
     * Repaint the `In book` marks after a save, without re-running the search.
     *
     * The alternative — refetching to learn what we just wrote — would cost
     * money on a surface whose entire design is about not spending it. The save
     * route already told us every lead id it created, so the feed has
     * everything it needs to be correct.
     */
    markSaved: (items) => {
      const byPlace = new Map(
        items.filter((item) => item.leadId).map((item) => [item.googlePlaceId, item]),
      )
      if (!byPlace.size) return

      set((prev) => ({
        rows: prev.rows.map((row) => {
          const item = byPlace.get(row.providerPlaceId)
          if (!item) return row
          return {
            ...row,
            savedLeadId: item.leadId,
            // A freshly saved lead is `new`; a refreshed one keeps the status
            // it already had, which this side does not know — so it says
            // nothing rather than guessing, and the library remains the source
            // of truth.
            savedStatus: item.outcome === 'saved' ? 'new' : row.savedStatus,
          }
        }),
      }))
    },

    setSelected: (selected) => set({ selected }),
    setSort: (sort) => set({ sort }),
  },
}))

/** The actions, as one reference that never changes. Never re-renders a caller. */
export function useFeedActions(): FeedActions {
  return useFeed((store) => store.actions)
}

function reduce(state: FeedState, event: SearchEvent): Partial<FeedState> {
  switch (event.type) {
    case 'meta':
      return {
        searchId: event.searchId,
        budget: event.budget,
        cachedAt: event.cached ? (event.cachedAt ?? null) : null,
        estimateUsd: event.estimate.maxCostUsd,
        estimateLabel: event.estimate.label,
        resolvedAddress: event.resolvedLocation?.formattedAddress ?? null,
      }

    case 'results':
      return { rows: [...state.rows, ...event.rows] }

    case 'cost':
      return {
        searchCostUsd: event.searchCostUsd,
        requests: event.requests,
        budget: state.budget
          ? {
              ...state.budget,
              monthToDateUsd: event.monthToDateUsd,
              ceilingUsd: event.ceilingUsd,
              remainingUsd: Math.max(0, event.ceilingUsd - event.monthToDateUsd),
              exhausted: event.monthToDateUsd >= event.ceilingUsd,
            }
          : state.budget,
      }

    case 'blocked':
      // Not an error: rows already on screen were paid for and are still good.
      return { status: 'blocked', blocked: event.message }

    case 'error':
      return { status: 'error', error: event.message }

    case 'done':
      /*
       * `done` closes the run; it does not overrule how the run ended.
       *
       * Both `blocked` and `error` are followed by a `done` carrying the final
       * total and cost — a search that stopped at the ceiling, or on a Google
       * outage half way through, still fetched and still billed for real rows.
       * Letting `done` reset the status would wipe the one sentence explaining
       * why the table is shorter than the operator asked for.
       */
      return {
        status: state.status === 'running' ? 'done' : state.status,
        searchCostUsd: event.searchCostUsd,
      }

    default:
      return {}
  }
}
