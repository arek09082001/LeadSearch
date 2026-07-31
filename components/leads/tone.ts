import type { ChangeDirection } from '@/lib/leads/changes'
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

/*
 * Direction, as brightness — the same instrument, pointed at a different scale.
 *
 * A change is not a fault and must not be coloured like one, but it is ranked
 * the same way and for the same reason: the eye has to be able to sort a screen
 * without reading it.
 *
 * `lost` is loudest because it is the closing window. A business that has just
 * built a website is a lead with a deadline on it — either he calls this week
 * about the site they have just paid someone else for, or the opening is gone.
 * `gained` is genuinely good news and still quieter, because nothing about it is
 * urgent: a site that fell over will still be down next month.
 *
 * Nothing here spends a signal colour. What tells a change apart from a fault is
 * WHERE it sits — beside the business name, never in the audit column — which is
 * a stronger distinction than a hue and survives being read at a glance.
 */
export const DIRECTION_TONE: Record<ChangeDirection, string> = {
  lost: 'text-ink',
  gained: 'text-ink-dim',
  neutral: 'text-ink-faint',
}
