import type { FindingSeverity } from '@/lib/enrichment/vocabulary'

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
