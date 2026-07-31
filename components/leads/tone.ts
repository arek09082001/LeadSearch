import type { FindingSeverity } from '@/lib/enrichment/vocabulary'
import type { LeadStatus } from '@/lib/leads/types'

/*
 * Severity, as brightness.
 *
 * Not colour: DESIGN.md allows exactly three signal colours and each already
 * means one thing, so how loudly a fault speaks is carried by contrast alone. A
 * critical sits at full ink and a merely informative one recedes, which is what
 * lets the eye rank a screen of leads without reading a word of it.
 *
 * In its own module because two surfaces render findings — the row in the book
 * and the lead's own diagnosis — and a fault that shouts on one and whispers on
 * the other would be a correctness bug wearing a styling bug's clothes.
 */
export const SEVERITY_TONE: Record<FindingSeverity, string> = {
  critical: 'text-ink',
  warning: 'text-ink-dim',
  info: 'text-ink-faint',
}

/**
 * Status, as brightness, for the same reason and by the same rule.
 *
 * How much of the operator's attention a status wants: untouched at full ink,
 * in-flight dimmed, closed faded back. Four surfaces render a status now — the
 * table, the queues, the control that sets it and the history that records it —
 * and a `new` that reads as urgent in one and settled in another would be the
 * ranking lying quietly.
 *
 * Deliberately not a client module: the timeline is a server component and
 * would otherwise be importing across the boundary to find out what colour a
 * word is.
 */
export const STATUS_TONE: Record<LeadStatus, string> = {
  new: 'text-ink',
  researching: 'text-ink-dim',
  contacted: 'text-ink-dim',
  replied: 'text-ink-dim',
  proposal: 'text-ink-dim',
  won: 'text-ink-faint',
  lost: 'text-ink-faint',
  parked: 'text-ink-faint',
}
