'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { TranscriptSegment } from '@/lib/assistant/types'
import { getTranscriptProvider } from '@/lib/transcript'
import type { TranscriptSession, TranscriptStatus } from '@/lib/transcript'

/*
 * Listening, and getting it written down.
 *
 * All of the call's moving parts live here so that the surface next door can be
 * read as a layout. Four things are going on at once — a recogniser pushing
 * text, a queue draining to the server, a clock ticking, and an operator who may
 * press stop at any point in the middle of the other three — and the whole
 * reason this is a hook rather than an effect in the component is that they have
 * to be able to be reasoned about together.
 *
 * THE QUEUE IS THE POINT. Every final line goes into `pending` and stays there
 * until the server has confirmed it. Nothing is dropped on a failed POST: the
 * batch goes back on the front of the queue and the next flush carries it. A
 * network that comes back after ninety seconds loses nothing, and the surface
 * can say — truthfully, from `unsaved` — how much is still only in this tab.
 *
 * WHY A FIXED FLUSH INTERVAL AND NOT A DEBOUNCE. A debounce sends when speech
 * pauses, which is exactly when a call ends — so the last and most valuable
 * batch would be racing the operator's hand to the stop button. On a clock, the
 * worst case is bounded and it is FLUSH_MS.
 */

/**
 * How long speech may live only in this tab.
 *
 * Three seconds. The brief is that a browser crash mid-call must not cost the
 * transcript, and this is the size of what it would cost — one sentence.
 * Shorter would spend a round trip per phrase for no gain the operator can feel.
 */
const FLUSH_MS = 3_000

/**
 * The subscribe half of a store that never changes.
 *
 * Module scope so its identity is stable across renders — `useSyncExternalStore`
 * resubscribes whenever this function changes, and one defined inline would do
 * that on every render forever.
 */
const subscribeToNothing = () => () => {}

export type SaveState = 'idle' | 'saving' | 'behind' | 'failed'

export interface CallTranscript {
  status: TranscriptStatus
  /** Everything final, oldest first. Seeded from the database on load. */
  segments: TranscriptSegment[]
  /** The line still being revised. Drawn, never stored. */
  interim: string
  /** Milliseconds of listening so far, for the clock. */
  elapsedMs: number
  error: string | null
  saveState: SaveState
  /** Lines said but not yet acknowledged by the server. */
  unsaved: number
  listening: boolean
  /** False when this browser has no recogniser at all. Checked after mount. */
  available: boolean
  providerId: string
  disclosure: string
  sendsAudioOffDevice: boolean
  start: () => void
  stop: () => void
}

export function useCallTranscript({
  callId,
  initialSegments,
  closed,
  onClosed,
}: {
  callId: string
  initialSegments: TranscriptSegment[]
  closed: boolean
  /** Fired once the call has been closed off server-side, so the page can redraw. */
  onClosed: () => void
}): CallTranscript {
  const provider = getTranscriptProvider()

  const [status, setStatus] = useState<TranscriptStatus>(closed ? 'stopped' : 'idle')
  const [segments, setSegments] = useState<TranscriptSegment[]>(initialSegments)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [unsaved, setUnsaved] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)

  const sessionRef = useRef<TranscriptSession | null>(null)
  const pendingRef = useRef<TranscriptSegment[]>([])
  const flushingRef = useRef(false)
  const startingRef = useRef(false)
  const originRef = useRef(0)
  const listening = status === 'starting' || status === 'listening'

  /*
   * Whether this browser has a recogniser at all.
   *
   * `isAvailable()` reads `window`, so it cannot be called during a server
   * render — and an effect that set it afterwards would be a second render on
   * every mount for a value that never changes. This is what
   * `useSyncExternalStore` is for: a browser capability is an external store
   * that happens to be constant. The server snapshot is `true` so the markup
   * arrives with the button enabled; Chrome agrees on hydration and nothing
   * moves, and the browsers that disagree are the ones that need the notice.
   */
  const available = useSyncExternalStore(
    subscribeToNothing,
    () => provider.isAvailable(),
    () => true,
  )

  /* --------------------------------------------------------------------- *
   * Draining the queue
   * --------------------------------------------------------------------- */

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    const batch = pendingRef.current
    if (!batch.length) return

    flushingRef.current = true
    pendingRef.current = []
    setSaveState('saving')

    try {
      const response = await fetch(`/api/calls/${callId}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: batch }),
        // The tab may be closing as this fires. `keepalive` is what lets the
        // last flush outlive the page that started it.
        keepalive: true,
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'The transcript could not be saved.')
      }

      setUnsaved(pendingRef.current.length)
      setSaveState(pendingRef.current.length ? 'behind' : 'idle')
    } catch (cause) {
      /*
       * Back on the front of the queue, in order. The alternative is losing the
       * words, and this whole file exists so that does not happen — a failed
       * save is a retry, not a deletion.
       */
      pendingRef.current = [...batch, ...pendingRef.current]
      setUnsaved(pendingRef.current.length)
      setSaveState('failed')
      console.error('[call] segment flush failed', cause)
    } finally {
      flushingRef.current = false
    }
  }, [callId])

  // The clock that drains it. Runs only while listening; the stop path flushes
  // once more on its own, so nothing is left behind when this comes down.
  useEffect(() => {
    if (!listening) return
    const timer = setInterval(() => void flush(), FLUSH_MS)
    return () => clearInterval(timer)
  }, [listening, flush])

  /* --------------------------------------------------------------------- *
   * The clock
   * --------------------------------------------------------------------- */

  /*
   * The origin lives in a ref rather than being recomputed from `elapsedMs`,
   * so the clock survives the recogniser restarting itself mid-call — which it
   * does, on every silence, without the call having paused.
   */
  useEffect(() => {
    if (status !== 'listening') return
    if (!originRef.current) originRef.current = Date.now()
    const timer = setInterval(() => setElapsedMs(Date.now() - originRef.current), 1_000)
    return () => clearInterval(timer)
  }, [status])

  /* --------------------------------------------------------------------- *
   * Not losing it on the way out
   * --------------------------------------------------------------------- */

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!pendingRef.current.length && !listening) return
      // The browser shows its own wording; what matters is that the tab with the
      // only copy of the last few sentences does not close silently.
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [listening])

  // A route change, a crash of this component, a closed tab: stop the microphone
  // and make one last attempt at the queue.
  useEffect(() => {
    return () => {
      sessionRef.current?.stop()
      sessionRef.current = null
      void flush()
    }
  }, [flush])

  /* --------------------------------------------------------------------- *
   * Start and stop
   * --------------------------------------------------------------------- */

  const start = useCallback(async () => {
    if (startingRef.current || sessionRef.current) return
    startingRef.current = true
    setError(null)
    setStatus('starting')

    try {
      /*
       * The clock is set server-side first, and the recogniser starts second.
       * `at_ms` is defined against `calls.started_at`, so the zero has to exist
       * before anything can be measured from it — and it is Postgres's `now()`,
       * not this browser's, because the two disagree and only one of them is in
       * the column.
       */
      const response = await fetch(`/api/calls/${callId}/listen`, { method: 'POST' })
      const body = (await response.json()) as { startedAt?: string; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'The call could not be opened.')

      sessionRef.current = provider.start({
        onStatus: (next) => setStatus(next),
        onError: (message) => setError(message),
        onChunk: (chunk) => {
          if (!chunk.final) {
            setInterim(chunk.text)
            return
          }

          const segment: TranscriptSegment = {
            atMs: chunk.atMs,
            speaker: chunk.speaker,
            text: chunk.text,
          }

          setInterim('')
          setSegments((current) => [...current, segment])
          pendingRef.current = [...pendingRef.current, segment]
          setUnsaved(pendingRef.current.length)
        },
      })
    } catch (cause) {
      setStatus('error')
      setError(cause instanceof Error ? cause.message : 'The call could not be opened.')
    } finally {
      startingRef.current = false
    }
  }, [callId, provider])

  const stop = useCallback(async () => {
    sessionRef.current?.stop()
    sessionRef.current = null
    setInterim('')
    setStatus('stopped')

    // The words first, then the closing stamp. The segments route refuses a call
    // that already has `ended_at`, so a stop that closed the call before
    // draining the queue would reject the last thing said on it.
    await flush()

    try {
      const response = await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended: true }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'The call could not be closed off.')
      }
      onClosed()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The call could not be closed off.')
    }
  }, [callId, flush, onClosed])

  return {
    status,
    segments,
    interim,
    elapsedMs,
    error,
    saveState,
    unsaved,
    listening,
    available,
    providerId: provider.id,
    disclosure: provider.disclosure,
    sendsAudioOffDevice: provider.sendsAudioOffDevice,
    start: () => void start(),
    stop: () => void stop(),
  }
}
