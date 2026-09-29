'use client'

import { useCallback, useEffect, useRef } from 'react'

/*
 * Ticking rows, as a gesture rather than sixty clicks.
 *
 * Both tables in this product are worked the same way: run down a page of
 * results and take a run of them — the twelve with no website, the eight from
 * one Ortsteil, the block between the two the eye stopped on. Doing that one
 * box at a time is the single most-repeated action on the surface and it was
 * the slowest thing here, so it gets the three gestures every list of records
 * has had since the first file manager:
 *
 *   click        tick one, and set the anchor
 *   shift+click  take everything between the anchor and here
 *   drag         paint a run without lifting the finger
 *
 * plus the keyboard versions of all three, because this is a keyboard-first
 * product and the mouse should never be the only way to say something.
 *
 * The range is a RUBBER BAND, not an accumulation. Every extension is painted
 * over the selection as it stood when the anchor was set, so pulling the range
 * back up un-ticks what pulling it down just ticked. The alternative — union
 * the range in each time — means a shift-click one row too far can only be
 * undone by clearing everything and starting again, which is exactly the moment
 * an operator gives up on the gesture and goes back to clicking boxes.
 *
 * The anchor is held by id, never by index: both tables re-sort under it, and a
 * range measured from "row 4" after a sort is a range from a different row.
 */

/** The row order, as drawn. Index in, id out — everything here speaks indexes. */
export interface RowSelection {
  /** A box was activated at this row, by mouse or by space. */
  pick: (index: number) => void
  /** Tick or un-tick one row, ignoring any modifier. The keyboard's `x`. */
  toggleAt: (index: number) => void
  /** Extend to this row, anchoring at `from` if there is nothing to extend from. */
  extendTo: (index: number, from: number) => void
  /** The header box. Clears the anchor: "everything" is not a range. */
  setAll: (checked: boolean) => void
  clear: () => void
  /** Handlers for the cell the box sits in — modifier state and the drag. */
  cellProps: (index: number) => {
    onPointerDown: (event: React.PointerEvent) => void
    onPointerEnter: () => void
  }
}

interface Anchor {
  /** Held by id: a re-sort moves the row, and the range has to move with it. */
  id: string
  /** The state the anchor was put into. The range is painted the same way. */
  mode: boolean
  /** The selection before the range began, so extending repaints from it. */
  base: Set<string>
}

export function useRowSelection({
  ids,
  selected,
  onSelect,
}: {
  /** Every row on screen, in the order it is drawn. */
  ids: string[]
  selected: Set<string>
  onSelect: (next: Set<string>) => void
}): RowSelection {
  const anchor = useRef<Anchor | null>(null)
  /**
   * The last selection this hook produced.
   *
   * Compared against the incoming one to notice that somebody else changed it —
   * a preset in the save bar, a bulk action finishing, a new search. Those all
   * invalidate the anchor: its `base` names rows that are no longer ticked, and
   * painting from it would put them back.
   */
  const emitted = useRef<Set<string> | null>(null)
  /** What the pointer said on the way down, consumed by the click it becomes. */
  const armed = useRef<{ index: number; shift: boolean } | null>(null)
  const drag = useRef<{ from: number; painting: boolean } | null>(null)
  /** A drag that ends where it began leaves a click behind. It is not a second tick. */
  const swallow = useRef(false)

  const emit = useCallback(
    (next: Set<string>) => {
      emitted.current = next
      onSelect(next)
    },
    [onSelect],
  )

  /** Drop the anchor if the selection moved under us. Called before every gesture. */
  const settle = useCallback(() => {
    if (emitted.current === selected) return
    emitted.current = null
    anchor.current = null
  }, [selected])

  const paint = useCallback(
    (from: number, to: number, mode: boolean, base: Set<string>) => {
      const next = new Set(base)
      const low = Math.max(0, Math.min(from, to))
      const high = Math.min(ids.length - 1, Math.max(from, to))
      for (let index = low; index <= high; index += 1) {
        if (mode) next.add(ids[index])
        else next.delete(ids[index])
      }
      emit(next)
    },
    [ids, emit],
  )

  /** One row, and the anchor moves here. */
  const tick = useCallback(
    (index: number) => {
      const id = ids[index]
      if (id === undefined) return
      const mode = !selected.has(id)
      anchor.current = { id, mode, base: selected }
      paint(index, index, mode, selected)
    },
    [ids, selected, paint],
  )

  const pick = useCallback(
    (index: number) => {
      const intent = armed.current
      armed.current = null

      // The tail of a paint drag. The rows are already right.
      if (swallow.current) {
        swallow.current = false
        return
      }

      settle()

      const from = anchor.current ? ids.indexOf(anchor.current.id) : -1
      if (intent?.shift && intent.index === index && anchor.current && from >= 0) {
        paint(from, index, anchor.current.mode, anchor.current.base)
        return
      }

      tick(index)
    },
    [ids, settle, paint, tick],
  )

  const toggleAt = useCallback(
    (index: number) => {
      armed.current = null
      settle()
      tick(index)
    },
    [settle, tick],
  )

  const extendTo = useCallback(
    (index: number, from: number) => {
      settle()

      const current = anchor.current
      const anchored = current ? ids.indexOf(current.id) : -1

      /*
       * Shift+j with nothing anchored means "start taking rows from here", so
       * the row the keyboard was on becomes the anchor and is taken too. Always
       * ticking rather than un-ticking: a selection that begins by clearing
       * something is not what the gesture reads as.
       */
      if (!current || anchored < 0) {
        const id = ids[from]
        if (id === undefined) return
        anchor.current = { id, mode: true, base: selected }
        paint(from, index, true, selected)
        return
      }

      paint(anchored, index, current.mode, current.base)
    },
    [ids, selected, settle, paint],
  )

  const setAll = useCallback(
    (checked: boolean) => {
      anchor.current = null
      emit(checked ? new Set(ids) : new Set())
    },
    [ids, emit],
  )

  const clear = useCallback(() => {
    anchor.current = null
    emit(new Set())
  }, [emit])

  /*
   * A paint drag ends wherever the button comes up, which is routinely outside
   * the table and sometimes outside the window. Only the document sees all of
   * those, so the end of the gesture is listened for there.
   */
  useEffect(() => {
    function end() {
      if (drag.current?.painting) swallow.current = true
      drag.current = null
    }
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    return () => {
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
    }
  }, [])

  const cellProps = useCallback(
    (index: number) => ({
      onPointerDown: (event: React.PointerEvent) => {
        swallow.current = false
        if (event.button !== 0) return

        /*
         * The modifier is read here rather than off the change event, because a
         * click on the cell around the box reaches the input through the label
         * and browsers do not agree about whether the modifiers come with it.
         * The pointer always goes down first, and this is what it said.
         */
        armed.current = { index, shift: event.shiftKey }

        if (event.shiftKey) {
          // Shift+click in a table is also the browser's "extend the highlight
          // to here". Nobody has ever meant both at once.
          window.getSelection()?.removeAllRanges()
          return
        }

        // Painting is a mouse gesture. The same drag on a touch screen is the
        // operator scrolling the table, and taking it would be indefensible.
        if (event.pointerType === 'mouse') drag.current = { from: index, painting: false }
      },

      onPointerEnter: () => {
        const session = drag.current
        if (!session) return

        /*
         * The first row entered is what turns a press into a drag — not the
         * press itself. That leaves the click on the starting row to do the
         * ordinary thing if the pointer never moves, so there is exactly one
         * path through a plain tick.
         *
         * Once painting, coming back to the row it started on is a real
         * position and has to repaint: dragging four rows down and back up is
         * how a range that went too far gets taken back, and stopping short of
         * the start would leave one row ticked that the operator just undid.
         */
        if (!session.painting) {
          if (session.from === index) return
          const id = ids[session.from]
          if (id === undefined) {
            drag.current = null
            return
          }
          settle()
          session.painting = true
          anchor.current = { id, mode: !selected.has(id), base: selected }
        }

        const current = anchor.current
        if (!current) return
        const from = ids.indexOf(current.id)
        if (from >= 0) paint(from, index, current.mode, current.base)
      },
    }),
    [ids, selected, settle, paint],
  )

  return { pick, toggleAt, extendTo, setAll, clear, cellProps }
}
