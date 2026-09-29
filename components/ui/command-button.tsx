import Link from 'next/link'
import type { ComponentProps } from 'react'

/*
 * A control on a dealing screen: a ruled rectangle with an uppercase label and,
 * where one exists, its key. Nothing rounded, no fill until you touch it.
 */

type Variant = 'default' | 'primary' | 'quiet'

const VARIANTS: Record<Variant, string> = {
  default:
    'border-rule-strong text-ink-dim hover:border-ink-faint hover:bg-raise hover:text-ink active:bg-rule',
  primary:
    'border-signal text-signal hover:bg-signal hover:text-ground active:bg-signal/80 active:text-ground',
  quiet: 'border-transparent text-ink-faint hover:border-rule-strong hover:text-ink-dim',
}

const BASE = [
  'label inline-flex items-center gap-2 border px-2.5 py-1.5',
  'transition-colors duration-150',
  'disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-ink-ghost',
].join(' ')

function classes(variant: Variant, className: string) {
  return [BASE, VARIANTS[variant], className].join(' ')
}

function KeyHint({ keyHint }: { keyHint?: string }) {
  if (!keyHint) return null
  return (
    <span aria-hidden="true" className="font-data text-micro opacity-60">
      {keyHint}
    </span>
  )
}

export function CommandButton({
  variant = 'default',
  keyHint,
  className = '',
  children,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; keyHint?: string }) {
  return (
    <button {...props} className={classes(variant, className)}>
      {children}
      <KeyHint keyHint={keyHint} />
    </button>
  )
}

/*
 * The same control when the action is navigation.
 *
 * A separate component on purpose: a <button> wrapped in a <Link> is invalid
 * HTML and announces as two nested controls.
 */
export function CommandLink({
  variant = 'default',
  keyHint,
  className = '',
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; keyHint?: string }) {
  return (
    <Link {...props} className={classes(variant, className)}>
      {children}
      <KeyHint keyHint={keyHint} />
    </Link>
  )
}
