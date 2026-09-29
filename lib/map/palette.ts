import { COLD_SCORE_FLOOR } from '@/lib/leads/types'

/*
 * The world's colours, as literals — the one place in the product where that is
 * allowed.
 *
 * Everything else styles itself with `text-ink-dim` and lets globals.css own the
 * hex. A map cannot: its basemap and its points are drawn into a WebGL canvas
 * from a style object, and a style object has nowhere to put a class name. So
 * the tokens are restated here, once, with the same names they carry in
 * `@theme` — and this file is the only place to change if a token moves.
 *
 * Values mirror app/globals.css exactly. A colour on the map that is not in this
 * table is a bug, not a decision.
 */
export const MAP_COLORS = {
  ground: '#0a0b0d',
  panel: '#101215',
  raise: '#171a1f',
  rule: '#21252b',
  ruleStrong: '#2f353d',
  ink: '#e8ebee',
  inkDim: '#98a0aa',
  inkFaint: '#7d8792',
  inkGhost: '#4a525b',
  signal: '#e0a340',
  live: '#4cc38a',
} as const

/**
 * Score, as brightness on one hue.
 *
 * DESIGN.md allows three signal colours and each already means one thing, so a
 * score cannot be a rainbow. It is a walk from `ink-faint` — the colour of a
 * label, i.e. of something present but not asking for anything — to `signal`,
 * which everywhere in this product means the book and the operator's own
 * decisions. A high scorer is the lead he should be deciding about, so it is the
 * one that glows.
 *
 * The middle stop sits at `COLD_SCORE_FLOOR` and is deliberately cooler than a
 * straight blend would put it. That is what makes the ramp accelerate exactly
 * where the Outreach queue draws its own line: below 60 the field is grey, above
 * it the amber arrives quickly. The map and the cold queue are then agreeing
 * about what "worth calling" looks like rather than each having an opinion.
 */
export const SCORE_STOPS: readonly { score: number; color: string }[] = [
  { score: 0, color: MAP_COLORS.inkFaint },
  { score: COLD_SCORE_FLOOR, color: '#a8945f' },
  { score: 100, color: MAP_COLORS.signal },
]

/**
 * The same ramp as a MapLibre expression.
 *
 * Takes the expression that produces the score, so it can be pointed at a
 * feature's own `score` or at a cluster's aggregated maximum without the two
 * ever drifting apart.
 */
export function scoreRamp(input: unknown): unknown[] {
  return [
    'interpolate',
    ['linear'],
    input,
    ...SCORE_STOPS.flatMap((stop) => [stop.score, stop.color]),
  ]
}

/**
 * A score, as a CSS colour — the DOM half of the same ramp.
 *
 * The side panel and the legend read scores too, and a dot in the panel that
 * disagreed with the dot on the canvas would make the map's one encoding
 * unreadable. Linear interpolation between the same stops, in sRGB, which is
 * what MapLibre's `interpolate` does with hex colours.
 */
export function scoreColor(score: number | null): string {
  if (score === null) return MAP_COLORS.inkGhost

  const value = Math.min(100, Math.max(0, score))
  const upper = SCORE_STOPS.findIndex((stop) => stop.score >= value)
  if (upper <= 0) return SCORE_STOPS[0].color

  const from = SCORE_STOPS[upper - 1]
  const to = SCORE_STOPS[upper]
  const t = (value - from.score) / (to.score - from.score)

  const mix = (a: string, b: string) =>
    Math.round(parseInt(a, 16) + t * (parseInt(b, 16) - parseInt(a, 16)))
      .toString(16)
      .padStart(2, '0')

  return `#${[1, 3, 5]
    .map((offset) =>
      mix(from.color.slice(offset, offset + 2), to.color.slice(offset, offset + 2)),
    )
    .join('')}`
}
