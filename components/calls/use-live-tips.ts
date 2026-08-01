'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { condense, manualTip, nextTip, TIP_HOLD_MS, type LiveTip } from '@/lib/assistant/triggers'
import type { Briefing, ShownTip, TranscriptSegment } from '@/lib/assistant/types'
import { TIP_SPECS } from '@/lib/assistant/vocabulary'

/*
 * The assistant, listening — in the tab, between the recogniser and the screen.
 *
 * The decisions all live next door in `lib/assistant/triggers.ts`, which is pure
 * and testable at a terminal. What is left here is the three things a pure
 * function cannot do: notice that a new line has arrived, hold a card up for
 * twenty seconds, and write down what happened.
 *
 * WHY THIS IS NOT A POLL. Nothing here asks a server whether there is a tip.
 * `nextTip` is called when a sentence lands and once a second against the clock,
 * and both are free — no request, no latency, nothing to abort. The one route
 * this hook can reach is `ask`, and only a keypress reaches it. That is what
 * makes a live assistant possible under a ceiling of zero.
 *
 * WHAT IT REFUSES TO DO ON MOUNT. A reloaded call arrives with its whole
 * transcript already written down, and running the rules over it would open the
 * page with five stale cards about a conversation that has moved on. The lines
 * that were already there are marked as read before the first render, and the
 * tips already shown come back from the database with them — so a trigger that
 * fired before the reload does not fire again after it.
 */

/** How long "nothing to add" stays up after a manual ask that found nothing. */
const EMPTY_MS = 4_000

export interface ShownLiveTip extends LiveTip {
  /**
   * The `call_tips` row, once the insert has come back. Null while it is in
   * flight, and null forever if it failed — which changes nothing on screen and
   * only means this one tip cannot be marked as used.
   */
  rowId: number | null
  actedOn: boolean
}

export interface LiveTips {
  /** The one tip on screen, or null — which is the answer most of the time. */
  current: ShownLiveTip | null
  /** A manual ask is in flight. The only thing here that can ever be waited on. */
  asking: boolean
  /** He asked, and there was honestly nothing. Clears itself. */
  empty: boolean
  /** Hide it. Not a verdict — `acted_on` stays false. */
  dismiss: () => void
  /** He used it. The only column in `call_tips` written by hand. */
  markUsed: () => void
  /** Ask for one anyway. The exception path, and the only one that costs. */
  ask: () => void
}

export function useLiveTips({
  callId,
  segments,
  elapsedMs,
  listening,
  consentNoted,
  briefing,
  initialShown,
}: {
  callId: string
  /** Everything final, oldest first, as `useCallTranscript` keeps it. */
  segments: TranscriptSegment[]
  elapsedMs: number
  listening: boolean
  consentNoted: boolean
  /**
   * The prepared briefing as DATA.
   *
   * The call page also passes it as a rendered node, and the two are not
   * redundant: one is what the operator reads in the left column, the other is
   * what the rules read to find a prepared answer for a trigger. Null is
   * ordinary — a cold call — and the standing lines cover it.
   */
  briefing: Briefing | null
  /** Tips already shown in this call, from the database. Survives a reload. */
  initialShown: readonly ShownTip[]
}): LiveTips {
  const [current, setCurrent] = useState<ShownLiveTip | null>(null)
  const [asking, setAsking] = useState(false)
  const [empty, setEmpty] = useState(false)

  /*
   * The decision state, in a ref rather than in state.
   *
   * Nothing here is drawn — it is what `nextTip` is given, not what the operator
   * sees — and holding it in state would re-run the effect that reads it every
   * time it changed, which is a loop that shows a tip, records it, and considers
   * showing another one about the same sentence.
   */
  const shownRef = useRef<ShownTip[]>([...initialShown])
  const lastRef = useRef<{ atMs: number | null; weight: number | null }>({
    atMs: null,
    weight: null,
  })

  /** How much of the transcript the rules have already been over. */
  const readRef = useRef(segments.length)
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emptyRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /*
   * The card on screen, mirrored.
   *
   * `markUsed` needs to read it and then fire a request, and doing both inside
   * a state updater would send the request twice under StrictMode — updaters
   * are called speculatively and must stay free of side effects. A ref is the
   * honest place for "what is on screen right now" when something other than
   * rendering has to ask.
   */
  const currentRef = useRef<ShownLiveTip | null>(null)
  useEffect(() => {
    currentRef.current = current
  }, [current])

  /* --------------------------------------------------------------------- *
   * Putting one up
   * --------------------------------------------------------------------- */

  const show = useCallback(
    (tip: LiveTip) => {
      shownRef.current = [...shownRef.current, { trigger: tip.trigger, atMs: tip.atMs }]
      lastRef.current = { atMs: tip.atMs, weight: TIP_SPECS[tip.trigger].weight }

      setEmpty(false)
      setCurrent({ ...tip, rowId: null, actedOn: false })

      // Twenty seconds, then it takes itself away. A tip that had to be
      // dismissed to stop being in the way would be one more thing to do
      // during a phone call.
      if (hideRef.current) clearTimeout(hideRef.current)
      hideRef.current = setTimeout(() => setCurrent(null), TIP_HOLD_MS)

      /*
       * Recorded, and not waited for. The tip is already on screen; the row is
       * for a question asked months from now. `shown` is true because this
       * function is the only thing that draws one — which is exactly the
       * distinction the column was added to keep honest.
       */
      void fetch(`/api/calls/${callId}/tips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          atMs: tip.atMs,
          trigger: tip.trigger,
          body: tip.body,
          shown: true,
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status))
          const written = (await response.json()) as { id?: number }
          if (typeof written.id !== 'number') return
          // Only if it is still the tip on screen. A slow insert coming back
          // after the next tip replaced this one must not hand the new card the
          // old row's id.
          setCurrent((live) =>
            live && live.atMs === tip.atMs && live.trigger === tip.trigger
              ? { ...live, rowId: written.id ?? null }
              : live,
          )
        })
        .catch((cause) => console.error('[call] could not record the tip', cause))
    },
    [callId],
  )

  /* --------------------------------------------------------------------- *
   * Listening
   * --------------------------------------------------------------------- */

  const consider = useCallback(
    (text: string, atMs: number) => {
      const tip = nextTip(text, {
        atMs,
        consentNoted,
        briefing,
        shown: shownRef.current,
        lastShownAtMs: lastRef.current.atMs,
        lastShownWeight: lastRef.current.weight,
      })
      if (tip) show(tip)
    },
    [briefing, consentNoted, show],
  )

  // Whatever has been said since the last look. One sentence at a time and in
  // order, so a batch arriving together is judged the way it was spoken.
  useEffect(() => {
    if (readRef.current >= segments.length) return

    const fresh = segments.slice(readRef.current)
    readRef.current = segments.length

    for (const segment of fresh) consider(segment.text, segment.atMs)
  }, [segments, consider])

  /*
   * And the clock, for the two rules that read no words at all. An empty string
   * is the supported way to ask `matchTriggers` what is true right now.
   *
   * No timer of its own: `elapsedMs` already ticks once a second next door, so
   * this runs on that tick. An interval here would have been re-created by its
   * own dependency on every tick and so would never have fired at all.
   */
  useEffect(() => {
    if (!listening) return
    consider('', elapsedMs)
  }, [listening, elapsedMs, consider])

  useEffect(
    () => () => {
      if (hideRef.current) clearTimeout(hideRef.current)
      if (emptyRef.current) clearTimeout(emptyRef.current)
    },
    [],
  )

  /* --------------------------------------------------------------------- *
   * The three keys
   * --------------------------------------------------------------------- */

  const dismiss = useCallback(() => {
    if (hideRef.current) clearTimeout(hideRef.current)
    currentRef.current = null
    setCurrent(null)
    setEmpty(false)
  }, [])

  const markUsed = useCallback(() => {
    const live = currentRef.current
    // Nothing on screen, already marked, or the row never came back — all three
    // are silent no-ops. A keypress that cannot be recorded should not become
    // an error message during a phone call.
    if (!live || live.actedOn || live.rowId === null) return

    currentRef.current = { ...live, actedOn: true }
    setCurrent((shownTip) => (shownTip ? { ...shownTip, actedOn: true } : shownTip))

    void fetch(`/api/calls/${callId}/tips`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: live.rowId }),
    }).catch((cause) => console.error('[call] could not mark the tip as used', cause))
  }, [callId])

  /**
   * What an ask falls back to: the strongest prepared objection not yet used.
   *
   * No network and no provider. He pressed a key because he wanted something,
   * and when the model path has nothing the honest cheapest answer is the best
   * line he prepared and has not reached for. When even that is exhausted the
   * column says so — a key that appears to do nothing is worse than a key that
   * says there is nothing.
   */
  const fallBack = useCallback(
    (atMs: number) => {
      const prepared = manualTip(briefing, shownRef.current, atMs)
      if (prepared) {
        show(prepared)
        return
      }

      setEmpty(true)
      if (emptyRef.current) clearTimeout(emptyRef.current)
      emptyRef.current = setTimeout(() => setEmpty(false), EMPTY_MS)
    },
    [briefing, show],
  )

  /**
   * Ask for one anyway.
   *
   * The provider first, because that is what the operator pressed the key for,
   * and the briefing second. This is the only path in a live call that reaches
   * `TipProvider` at all, and it is reachable only by a human hand — see the
   * route for why that bound is the one keeping the ceiling honest.
   */
  const ask = useCallback(async () => {
    if (asking) return
    setAsking(true)
    setEmpty(false)

    const atMs = elapsedMs

    try {
      const response = await fetch(`/api/calls/${callId}/tips/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atMs, shown: shownRef.current }),
      })

      const body = (await response.json().catch(() => ({}))) as {
        tip?: { trigger?: string; body?: string } | null
      }

      if (body.tip?.trigger && body.tip.body && body.tip.trigger in TIP_SPECS) {
        show({
          trigger: body.tip.trigger as LiveTip['trigger'],
          // Truncated rather than trusted, exactly as the boundary says to:
          // a provider that ignores the bound must not be able to push this
          // layout around while the operator is mid-sentence.
          body: condense(body.tip.body),
          source: 'provider',
          atMs,
        })
        return
      }

      fallBack(atMs)
    } catch (cause) {
      // A failed ask is not a failed call. The prepared objections are already
      // in the tab and need no network to reach.
      console.error('[call] could not ask for a tip', cause)
      fallBack(atMs)
    } finally {
      setAsking(false)
    }
    // `briefing` is absent on purpose: this reaches it only through `fallBack`,
    // which already depends on it.
  }, [asking, callId, elapsedMs, fallBack, show])

  /*
   * Three keys, on the window, because the operator has a phone in one hand and
   * will not be clicking anything. Ignored while he is typing — the consent
   * checkbox and the Start button are both focusable, and Enter on a focused
   * button must stay the button's.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
      if (target?.isContentEditable) return

      if (event.key === 'Escape') {
        dismiss()
        return
      }

      if (event.key === 'Enter') {
        markUsed()
        return
      }

      if (event.key === 'a' || event.key === 'A') {
        event.preventDefault()
        void ask()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask, dismiss, markUsed])

  return { current, asking, empty, dismiss, markUsed, ask }
}
