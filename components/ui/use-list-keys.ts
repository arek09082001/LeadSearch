'use client'

import { useEffect } from 'react'

/*
 * The keyboard, for any surface that is a list of leads.
 *
 * One vocabulary across the book and the queue, because they are the same
 * gesture done in two places: run down the rows, open one, act on one. It is
 * deliberately the vi set — j/k rather than arrows alone — for the same reason
 * the rest of the product is shaped like a terminal, and the arrows work too so
 * nobody has to know that.
 *
 * The keys are bare, with no modifier. That is only affordable because Alt owns
 * surface switching and because every handler here stands down the moment the
 * operator is typing: a `j` in the search field is a letter, and treating it as
 * a movement is the single way a keymap like this becomes unusable.
 *
 *   j / ↓   next row            x       tick the row the cursor is on
 *   k / ↑   previous row        ⇧j / ⇧k extend the tick to the next row
 *   enter   open the focused    a       tick every row, or none
 *   s       save what this      escape  give the keyboard back
 *           surface saves       /       focus the filter
 *
 * Shift is the modifier the selection gestures share with the mouse: ⇧j does to
 * the keyboard exactly what shift+click does to the pointer, and both measure
 * from the same anchor. It is deliberately not a fourth movement key — the
 * cursor moves the way it always did, and shift only says "and take it".
 */

const TYPING = 'input, textarea, select, [contenteditable]'

/** Marks the row the cursor is on, so the hook can keep it on screen. */
export function cursorProps(active: boolean) {
  return {
    'data-cursor': active ? 'on' : undefined,
    'aria-current': active ? ('true' as const) : undefined,
  }
}

export function useListKeys({
  count,
  cursor,
  onCursor,
  onOpen,
  onSave,
  onSearch,
  onEscape,
  onToggle,
  onExtend,
  onSelectAll,
}: {
  count: number
  /** -1 when the cursor is nowhere, which is where it starts. */
  cursor: number
  onCursor: (next: number) => void
  onOpen?: (index: number) => void
  onSave?: (index: number) => void
  /** Focus the surface's own filter field. */
  onSearch?: () => void
  /** Dismiss whatever is open — selection, cursor, staged edit. */
  onEscape?: () => void
  /** Tick or un-tick one row. */
  onToggle?: (index: number) => void
  /** Extend the tick from where the cursor was to where it now is. */
  onExtend?: (to: number, from: number) => void
  /** Everything, or nothing — the header box without reaching for it. */
  onSelectAll?: () => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Alt is the nav's, and the browser owns the other two.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target as HTMLElement | null
      const typing = Boolean(target?.closest?.(TYPING))

      /*
       * Escape is the one key that means something while typing, and it means
       * the same thing it means everywhere else: give the keyboard back. It
       * blurs the field and stops there — the surface's own escape would
       * otherwise clear a selection the operator was in the middle of naming.
       */
      if (event.key === 'Escape') {
        if (typing) {
          target?.blur()
          return
        }
        onEscape?.()
        return
      }

      if (typing) return

      switch (event.key) {
        case 'j':
        case 'J':
        case 'ArrowDown': {
          if (!count) return
          event.preventDefault()
          // A cursor that is nowhere lands on the first row rather than the
          // second, so the first ⇧j takes row one instead of skipping it.
          const from = cursor < 0 ? 0 : cursor
          const to = cursor < 0 ? 0 : Math.min(count - 1, cursor + 1)
          if (event.shiftKey) onExtend?.(to, from)
          onCursor(to)
          break
        }

        case 'k':
        case 'K':
        case 'ArrowUp': {
          if (!count) return
          event.preventDefault()
          const from = cursor < 0 ? 0 : cursor
          const to = cursor <= 0 ? 0 : cursor - 1
          if (event.shiftKey) onExtend?.(to, from)
          onCursor(to)
          break
        }

        case 'x': {
          // The Gmail key, and the reason the cursor exists at all on a surface
          // whose rows are acted on in bulk.
          if (!count || !onToggle) return
          event.preventDefault()
          const index = cursor < 0 ? 0 : cursor
          onToggle(index)
          onCursor(index)
          break
        }

        case 'a':
          if (!count || !onSelectAll) return
          event.preventDefault()
          onSelectAll()
          break

        case 'Enter':
          // Bounds, not just presence: a row worked in the queue leaves it on
          // the next refresh, and the cursor can be left pointing past the end.
          if (cursor < 0 || cursor >= count || !onOpen) return
          event.preventDefault()
          onOpen(cursor)
          break

        case 's':
          if (!onSave) return
          event.preventDefault()
          onSave(cursor)
          break

        case '/':
          if (!onSearch) return
          // Without this the slash lands in the field it just focused.
          event.preventDefault()
          onSearch()
          break

        default:
          break
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    count,
    cursor,
    onCursor,
    onOpen,
    onSave,
    onSearch,
    onEscape,
    onToggle,
    onExtend,
    onSelectAll,
  ])

  /*
   * Keep the cursor on screen. Found in the DOM rather than through a ref per
   * row: the two surfaces that use this draw their rows differently — one a
   * table, one a list of blocks — and an array of refs threaded through both
   * would be more machinery than a single attribute they already set.
   *
   * `block: 'nearest'` scrolls only when the row is actually out of view, so
   * running down a visible page does not jerk the table under the eye.
   */
  useEffect(() => {
    if (cursor < 0) return
    document.querySelector('[data-cursor="on"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])
}
