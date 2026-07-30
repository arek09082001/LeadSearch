'use client'

import { useCallback, useRef, useState } from 'react'

import type { BudgetState, SearchEvent, SearchInput, SearchRow } from '@/lib/search/types'

/*
 * Reads the NDJSON search stream and keeps the table in step with it.
 *
 * Rows are appended per page rather than replaced at the end, because the whole
 * point of the stream is that the operator starts reading page one while page
 * three is still in flight. State is deliberately flat and boring — this hook
 * owns the wire, not the presentation.
 */

export type SearchStatus = 'idle' | 'running' | 'done' | 'blocked' | 'error'

export interface SearchStreamState {
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
}

const INITIAL: SearchStreamState = {
  status: 'idle',
  rows: [],
  searchCostUsd: 0,
  requests: 0,
  budget: null,
  cachedAt: null,
  error: null,
  blocked: null,
  estimateUsd: null,
  estimateLabel: null,
  resolvedAddress: null,
}

export function useSearchStream(initialBudget: BudgetState) {
  const [state, setState] = useState<SearchStreamState>({ ...INITIAL, budget: initialBudget })
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState((prev) => (prev.status === 'running' ? { ...prev, status: 'done' } : prev))
  }, [])

  const run = useCallback(async (input: SearchInput) => {
    // A second search replaces the first rather than racing it.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState((prev) => ({ ...INITIAL, budget: prev.budget, status: 'running' }))

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
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: message ?? `The search request failed (HTTP ${response.status}).`,
        }))
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
          if (line) setState((prev) => reduce(prev, JSON.parse(line) as SearchEvent))
        }
      }

      setState((prev) => (prev.status === 'running' ? { ...prev, status: 'done' } : prev))
    } catch (error) {
      // An abort is the operator changing their mind, not a failure.
      if (controller.signal.aborted) return
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'The search could not be reached.',
      }))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  const setBudget = useCallback((budget: BudgetState) => {
    setState((prev) => ({ ...prev, budget }))
  }, [])

  return { state, run, cancel, setBudget }
}

function reduce(state: SearchStreamState, event: SearchEvent): SearchStreamState {
  switch (event.type) {
    case 'meta':
      return {
        ...state,
        budget: event.budget,
        cachedAt: event.cached ? (event.cachedAt ?? null) : null,
        estimateUsd: event.estimate.maxCostUsd,
        estimateLabel: event.estimate.label,
        resolvedAddress: event.resolvedLocation?.formattedAddress ?? null,
      }

    case 'results':
      return { ...state, rows: [...state.rows, ...event.rows] }

    case 'cost':
      return {
        ...state,
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
      return { ...state, status: 'blocked', blocked: event.message }

    case 'error':
      return { ...state, status: 'error', error: event.message }

    case 'done':
      return {
        ...state,
        status: state.status === 'blocked' ? 'blocked' : 'done',
        searchCostUsd: event.searchCostUsd,
      }

    default:
      return state
  }
}
