'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/*
 * The keyboard, as one implementation.
 *
 * DESIGN.md asks for a keyboard path to every control and the operator works at
 * a desk in hour-long sessions, so the pointer is the fallback here rather than
 * the assumption. Until now each component owned a local `onKeyDown` and there
 * was no way to move through a surface at all — this module is the missing half.
 *
 * The map, and it is the same on every surface that has rows:
 *
 *   j / ArrowDown   move down          Enter   open the row under the cursor
 *   k / ArrowUp     move up            s       save — commit what the row is for
 *   /               focus the search   Escape  leave the field, drop the cursor
 *
 * Deliberately unmodified letters. `Alt+1/2/3` already moves between surfaces
 * and Alt was chosen there so plain keys stayed free for exactly this.
 */

/** The search field a surface offers to `/`. One attribute, so any surface can. */
export const SEARCH_ATTRIBUTE = 'data-key-search'

/** Rows opt into the cursor by carrying their index. */
export const ROW_ATTRIBUTE = 'data-key-row'

/**
 * Is the operator typing?
 *
 * Every plain-letter binding has to stand down inside a field, or `s` becomes
 * unwritable in a note and `/` cannot be typed into a search box at all.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** A modifier means the keystroke belongs to the browser or the OS, not to us. */
function modified(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey
}

function focusSearch(): boolean {
  const field = document.querySelector<HTMLInputElement>(`[${SEARCH_ATTRIBUTE}]`)
  if (!field) return false
  field.focus()
  field.select()
  return true
}

/**
 * One plain key, bound for as long as the component is mounted.
 *
 * The handler is read through a ref so a caller may pass a fresh closure every
 * render — which every caller does — without tearing down and rebinding the
 * listener each time.
 */
export function useHotkey(key: string, handler: () => void, enabled = true): void {
  const latest = useRef(handler)

  useEffect(() => {
    latest.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== key || modified(event) || isTypingTarget(event.target)) return
      event.preventDefault()
      latest.current()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, enabled])
}

/**
 * A cursor over a list of rows.
 *
 * The cursor is real DOM focus, not a coloured row. That is the whole design
 * decision in this hook: focus is already visible through the global 1px
 * `signal` outline, it is what a screen reader follows, and it means the row
 * under the cursor and the row the browser considers current can never
 * disagree. The alternative — a `cursor` index painted as a background — would
 * have been a second, invisible notion of "here".
 *
 * Rows carry `data-key-row={index}` and `tabIndex={-1}`; everything else is
 * done from here.
 */
export function useRowCursor({
  count,
  onOpen,
  onSave,
  onEscape,
  enabled = true,
}: {
  count: number
  /** Enter. The row's own primary act — on a book of leads, opening it. */
  onOpen: (index: number) => void
  /** `s`. What this surface means by saving; omitted where it means nothing. */
  onSave?: (index: number) => void
  /** Escape, once no field holds focus. Clearing a selection, typically. */
  onEscape?: () => void
  enabled?: boolean
}): {
  cursor: number
  setCursor: (index: number) => void
  containerRef: RefObject<HTMLDivElement | null>
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState(-1)

  const handlers = useRef({ onOpen, onSave, onEscape })
  useEffect(() => {
    handlers.current = { onOpen, onSave, onEscape }
  }, [onOpen, onSave, onEscape])

  /*
   * A shorter page must not leave the cursor pointing past the end. Adjusted
   * during render rather than in an effect, so no frame is ever committed with
   * a cursor that has nothing under it.
   */
  const [lastCount, setLastCount] = useState(count)
  if (lastCount !== count) {
    setLastCount(count)
    if (cursor >= count) setCursor(count - 1)
  }

  /** Move the DOM's idea of "here" to match ours. */
  const focusRow = useCallback((index: number) => {
    const row = containerRef.current?.querySelector<HTMLElement>(`[${ROW_ATTRIBUTE}="${index}"]`)
    if (!row) return
    row.focus()
    // `nearest` and not `center`: on a hundred-row table, re-centring on every
    // keystroke turns j into a scroll rather than a step.
    row.scrollIntoView({ block: 'nearest' })
  }, [])

  const move = useCallback(
    (delta: number) => {
      if (count === 0) return
      // The first press lands on the first row rather than the second, which is
      // what "start moving" means from nothing.
      const next = cursor < 0 ? (delta > 0 ? 0 : count - 1) : cursor + delta
      const clamped = Math.min(count - 1, Math.max(0, next))
      setCursor(clamped)
      focusRow(clamped)
    },
    [count, cursor, focusRow],
  )

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      if (modified(event)) return

      /*
       * Escape is the one key that also acts inside a field, because leaving
       * the field is most of what it is for. Blurring rather than clearing:
       * the operator has just typed a query, and Escape emptying it would be a
       * destructive reading of "stop".
       */
      if (event.key === 'Escape') {
        if (isTypingTarget(event.target)) {
          ;(event.target as HTMLElement).blur()
          return
        }
        setCursor(-1)
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        handlers.current.onEscape?.()
        return
      }

      if (isTypingTarget(event.target)) return

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          move(1)
          return
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          move(-1)
          return
        case 'Enter':
          if (cursor < 0) return
          event.preventDefault()
          handlers.current.onOpen(cursor)
          return
        case 's':
          if (cursor < 0 || !handlers.current.onSave) return
          event.preventDefault()
          handlers.current.onSave(cursor)
          return
        case '/':
          // Only swallow the key if there is somewhere for it to go, so a
          // surface without a search field does not silently eat a slash.
          if (focusSearch()) event.preventDefault()
          return
        default:
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, cursor, move])

  const place = useCallback(
    (index: number) => {
      setCursor(index)
      focusRow(index)
    },
    [focusRow],
  )

  return { cursor, setCursor: place, containerRef }
}
