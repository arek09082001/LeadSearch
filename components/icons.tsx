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

/** Clear: two rules struck through each other. */
export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 3.5 12.5 12.5" />
      <path d="M12.5 3.5 3.5 12.5" />
    </Svg>
  )
}

/** Disclosure: a tick pointing at what opens. */
export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </Svg>
  )
}

/** Leaving the instrument: a rule out of a bracket. */
export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 3.5h-5v9h9v-5" />
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 7.5 8.5" />
    </Svg>
  )
}

/** Save to the book: adding a record. */
export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5v11" />
      <path d="M2.5 8h11" />
    </Svg>
  )
}

/** Already filed: a mark against a record. */
export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 8.5 6 12l7.5-8" />
    </Svg>
  )
}

/** The ceiling: a hard stop, not a warning. */
export function IconCeiling(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 3.5h13" />
      <path d="M8 13.5V6.5" />
      <path d="M5 9.5 8 6.5l3 3" />
    </Svg>
  )
}

/** Partial selection: one rule, struck across. Never a shrunken tick. */
export function IconMinus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8h10" />
    </Svg>
  )
}

/** Delete: a record struck out of the book. Soft — the rule, not a fire. */
export function IconStrike(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 2.5h9v11h-9z" />
      <path d="M5.5 8h5" />
    </Svg>
  )
}

/** Undo: back the way it came. */
export function IconUndo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 8A5.5 5.5 0 1 0 4.4 3.8" />
      <path d="M2.5 1.5v3h3" />
    </Svg>
  )
}

/** Filter: a field narrowed, rule by rule. */
export function IconFilter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 3.5h12" />
      <path d="M4.5 8h7" />
      <path d="M6.5 12.5h3" />
    </Svg>
  )
}

/** A saved view: a page marked so you can get back to it. */
export function IconMark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2.5h8v11l-4-3.5-4 3.5z" />
    </Svg>
  )
}

/** More: the actions that did not fit. */
export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8h.01" />
      <path d="M8 8h.01" />
      <path d="M13 8h.01" />
    </Svg>
  )
}

/** Export: the record leaving the product, down onto a rule. */
export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5v7.5" />
      <path d="M4.5 6.5 8 10l3.5-3.5" />
      <path d="M2.5 13.5h11" />
    </Svg>
  )
}

/** Ask Google again. A cycle drawn as brackets, not a rounded arrow. */
export function IconSync(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9" />
      <path d="M12 1.5v3h-3" />
      <path d="M4 14.5v-3h3" />
    </Svg>
  )
}

/** The audit, mid-flight. Paired with a pulse, never spun. */
export function IconPulse(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3" />
    </Svg>
  )
}
