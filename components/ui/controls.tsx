'use client'

import { useEffect, useRef, useState } from 'react'

import { IconCheck, IconChevronDown, IconMinus } from '@/components/icons'

/*
 * The controls the library needs that the search surface did not.
 *
 * Same grammar throughout: a ruled rectangle, no fill until touched, nothing
 * rounded, `signal` reserved for the operator's own decisions. A checkbox here
 * is a box with a rule around it, because that is what everything else is.
 */

/** The one input treatment, lifted out of the search form so both agree. */
export const INPUT =
  'w-full border border-rule bg-ground px-2.5 py-2 font-data text-sm text-ink outline-none ' +
  'transition-colors hover:border-rule-strong focus:border-signal ' +
  'placeholder:text-ink-faint disabled:border-rule disabled:text-ink-ghost'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label flex items-baseline gap-1.5 text-ink-faint">
        {label}
        {hint ? <span className="font-data text-micro normal-case">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

/**
 * A real checkbox, styled — not a div pretending.
 *
 * `appearance-none` on the native input keeps every keyboard, screen-reader and
 * form behaviour intact while letting the box follow the world's rules. The
 * indeterminate state is a struck rule rather than a smaller tick: "some of
 * these" and "all of these" must not be distinguished only by size.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
  className = '',
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  /** Always required — it is the accessible name, even when visually absent. */
  label: string
  disabled?: boolean
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  // Indeterminate is a DOM property with no HTML attribute, so it can only be
  // set imperatively. This is the one legitimate ref-into-the-DOM in the set.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])

  const marked = checked || indeterminate

  return (
    <span className={`relative inline-flex size-3.5 shrink-0 items-center justify-center ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        className={
          'peer absolute inset-0 m-0 cursor-pointer appearance-none border bg-ground transition-colors ' +
          'border-rule-strong hover:border-ink-faint ' +
          'checked:border-signal checked:bg-signal indeterminate:border-signal indeterminate:bg-signal ' +
          'disabled:cursor-not-allowed disabled:border-rule'
        }
      />
      {marked ? (
        // Drawn on the amber fill, so the glyph is ground-coloured.
        checked ? (
          <IconCheck className="pointer-events-none size-3 text-ground" />
        ) : (
          <IconMinus className="pointer-events-none size-3 text-ground" />
        )
      ) : null}
    </span>
  )
}

/**
 * A dropdown anchored to its trigger.
 *
 * Not a modal: the operator is mid-selection and covering the table would make
 * him lose his place. Closes on Escape and on a pointer outside, the way the
 * category combobox already does — one menu behaviour in the product, not two.
 */
export function Menu({
  label,
  children,
  align = 'left',
  disabled,
  variant = 'default',
  width = 'w-64',
}: {
  label: React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  disabled?: boolean
  variant?: 'default' | 'quiet' | 'alert'
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      /*
       * Escape puts the caret back on the control that opened the panel.
       *
       * Without this, dismissing a filter menu from the keyboard drops focus to
       * the document and the next Tab starts from the top of the page — which
       * on this surface means tabbing back through the whole filter bar to
       * reach the next menu. In a product whose brief is keyboard-first, a
       * dismiss that costs the operator his place is worse than no shortcut.
       */
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const trigger =
    variant === 'alert'
      ? 'border-rule-strong text-ink-dim hover:border-alert hover:text-alert'
      : variant === 'quiet'
        ? 'border-transparent text-ink-faint hover:border-rule-strong hover:text-ink-dim'
        : 'border-rule-strong text-ink-dim hover:border-ink-faint hover:bg-raise hover:text-ink'

  return (
    <div ref={rootRef} className="relative">
      {/*
        A disclosure, announced as one. `aria-haspopup` was claiming a menu, and
        what opens is not one: these panels hold checkboxes, number fields and
        text inputs, and a screen reader told to expect menu semantics will
        promise arrow-key navigation that does not exist. `aria-expanded` on a
        button with the panel next to it is the honest description and the one
        that matches what the panel actually is.
      */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={
          `label inline-flex items-center gap-1.5 border px-2 py-1.5 transition-colors ${trigger} ` +
          `${open ? 'bg-raise text-ink' : ''} disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-ghost`
        }
      >
        {label}
        <IconChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          className={`absolute top-full z-30 mt-px max-h-80 overflow-y-auto border border-rule-strong bg-panel ${width} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

/** A row inside a Menu. Full width, ruled, never a pill. */
export function MenuItem({
  onClick,
  children,
  tone = 'default',
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  tone?: 'default' | 'alert'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors ' +
        (tone === 'alert'
          ? 'text-ink-dim hover:bg-raise hover:text-alert '
          : 'text-ink-dim hover:bg-raise hover:text-ink ') +
        'disabled:cursor-not-allowed disabled:text-ink-ghost'
      }
    >
      {children}
    </button>
  )
}

/** A heading inside a Menu, when one holds more than one kind of thing. */
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="label border-b border-rule bg-ground px-2.5 py-1 text-ink-faint">{children}</div>
  )
}

/**
 * A checkable row inside a Menu — the shape every multi-value filter takes.
 *
 * The count sits on the right in `data` so the numbers form a column the eye
 * can run down, which is the whole reason to show counts at all.
 */
export function MenuCheck({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  count?: number
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 transition-colors hover:bg-raise">
      <Checkbox checked={checked} onChange={onChange} label={label} />
      <span className={`min-w-0 flex-1 truncate text-sm ${checked ? 'text-ink' : 'text-ink-dim'}`}>
        {label}
      </span>
      {count !== undefined ? (
        <span className="shrink-0 font-data text-micro text-ink-faint">{count}</span>
      ) : null}
    </label>
  )
}
