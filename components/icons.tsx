/*
 * Authored icon set. One grid (16), one stroke (1.5), butt caps, no fills.
 * Drawn in the terminal world's grammar: rules, ticks and brackets, nothing
 * rounded. Keep additions on the same grid or they will read as foreign.
 */

type IconProps = {
  className?: string
  /** "none" lets a rule-like glyph stretch to its box instead of centring. */
  preserveAspectRatio?: string
}

function Svg({
  className,
  preserveAspectRatio,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      preserveAspectRatio={preserveAspectRatio}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Search: a sweep across a field. */
export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 14 14" />
    </Svg>
  )
}

/** Leads: the book — stacked records, held. */
export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 3h11v10h-11z" />
      <path d="M2.5 6h11M2.5 9h11M5.5 3v10" />
    </Svg>
  )
}

/** Outreach: a signal going out. */
export function IconSignal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 13.5V6" />
      <path d="M4.5 6 8 2.5 11.5 6" />
      <path d="M2.5 13.5h11" />
    </Svg>
  )
}

/** Alert: a struck bar. Reserved for real failure. */
export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5v7" />
      <path d="M8 12v1.5" />
      <path d="M1.5 14.5h13" />
    </Svg>
  )
}

/** Refresh: re-fetch volatile data. */
export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 8A5.5 5.5 0 1 1 11.6 3.8" />
      <path d="M13.5 1.5V4.5H10.5" />
    </Svg>
  )
}

/** Sign out: leaving the desk. */
export function IconExit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 2.5h-7v11h7" />
      <path d="M6.5 8h7" />
      <path d="M11 5.5 13.5 8 11 10.5" />
    </Svg>
  )
}
