---
name: Lead Engine
description: A dealing screen for local prospects — dense, quiet, keyboard-first.
colors:
  ground: "#0a0b0d"
  panel: "#101215"
  raise: "#171a1f"
  rule: "#21252b"
  rule-strong: "#2f353d"
  ink: "#e8ebee"
  ink-dim: "#98a0aa"
  ink-faint: "#7d8792"
  ink-ghost: "#4a525b"
  signal: "#e0a340"
  live: "#4cc38a"
  alert: "#ef5f5f"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "normal"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "normal"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: "1.375rem"
    letterSpacing: "normal"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.08em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1.0625rem"
    letterSpacing: "normal"
    fontFeature: "tnum 1, zero 1"
rounded:
  none: "0px"
spacing:
  hair: "2px"
  tight: "6px"
  snug: "8px"
  base: "12px"
  loose: "16px"
components:
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.signal}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  button-primary-hover:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.ground}"
  button-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  button-default-hover:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-ghost}"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
  input-focus:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
  status-strip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-faint}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  masthead:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink-faint}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
---

# Design

## Overview

**North star: the dealing screen.** Lead Engine is arranged the way a market terminal
is — a dense field of records, read at speed, by one person who already knows what
everything means. It is explicitly not a dashboard: no cards, no stat tiles, no charts,
no chrome competing with data.

The single organising idea is the product's own split, made visible. A market terminal
distinguishes the **live feed** (ticking, timestamped, expiring) from **your book** (yours,
permanent, annotated). Lead Engine uses exactly that distinction for search results versus
saved leads. Any surface must declare which of the two it is showing, and how old it is.

This world was chosen against three anti-references named by the operator: generic SaaS
admin templates, CRM dashboards covered in donut charts, and purple-to-blue gradient heroes.
Nothing in this system should be reachable from any of them.

## Colors

Strategy: **Restrained** — neutrals carry the surface, amber is the only accent, and the
remaining two colors are pure signal.

| Token | Value | Role |
| --- | --- | --- |
| `ground` | `#0a0b0d` | The field. Every surface starts here. |
| `panel` | `#101215` | Strips and inset blocks, one step up from the field. |
| `raise` | `#171a1f` | Hover fills and skeleton bars. |
| `rule` | `#21252b` | The default hairline. This is the structural element. |
| `rule-strong` | `#2f353d` | Dividers and resting control borders. |
| `ink` | `#e8ebee` | Primary text. |
| `ink-dim` | `#98a0aa` | Secondary text. |
| `ink-faint` | `#7d8792` | Labels, placeholders, key hints. **Lowest legal text color.** |
| `ink-ghost` | `#4a525b` | **Non-text only.** Empty-state rules, disabled glyphs. |
| `signal` | `#e0a340` | The accent. Primary actions, focus, the active surface, the book. |
| `live` | `#4cc38a` | Live/transient data. Never decoration. |
| `alert` | `#ef5f5f` | Failure and destructive intent. Never decoration. |

Dark ground is chosen from the use scene, not the category: one operator, at a desk, in
hour-long sessions running into the evening. `color-scheme: dark` is set so scrollbars and
native controls follow the world.

Every text token above meets WCAG AA on `ground` (verified against the rendered page:
`ink` 15.7:1, `ink-dim` 7.3:1, `ink-faint` 5.4:1). `ink-ghost` is 2.7:1 and is therefore
**forbidden for text** — it exists for borders and rules only.

## Typography

Two faces, both self-hosted through `next/font`:

- **Archivo** — UI voice. Grotesk with enough width control to hold up in uppercase at 11px.
- **JetBrains Mono** — every figure, timestamp, identifier and measurement, with
  `tabular-nums` and slashed zero forced on. Monospace here is for data and measurement,
  never as a "technical" costume.

The scale is deliberately small and tight, optimized for the tenth minute of a session:
10px micro, 11px label, 12px small, **13px body**, 15px title, 19px headline, 24px display.

The `label` utility (uppercase, 11px, 600, `0.08em` tracking) is the workhorse — it names
surfaces, controls, and columns. It intentionally sets **no color**, so callers own it and
it never wins a specificity fight against an active state.

## Layout

Content is **edge to edge**. There is no centred max-width column: every horizontal pixel
is a column of data the operator wants. Only prose blocks (empty and error states) are
measured, at 46–52ch.

The frame is three stacked bands:

1. **Masthead** — a sticky 1px-ruled row: wordmark, surfaces, session identity.
2. **Status strip** — provenance (`LIVE` / `BOOK`), what that means, and the age of the data.
3. **Content** — everything else, filling remaining height.

Responsive: desktop-primary, phone-tolerant. Below `md` the wordmark, the key hints and the
provenance sentence drop out, in that order of expendability; the dot, the surface label and
the record count never do. Verified zero horizontal overflow at 360, 414, 768, 1024 and
1440px on every surface.

## Elevation & Depth

**There are no shadows.** Depth is tonal and linear: `ground` → `panel` → `raise`, separated
by 1px `rule` hairlines. A shadow anywhere in this system is a defect.

The masthead is the one exception to flatness, and only barely: it is sticky with a 2px
backdrop blur and a 95%-opacity ground, so data scrolls *under* a rule rather than colliding
with it.

## Shapes

**Nothing is rounded.** `--radius-none: 0px` is the only radius token and there is no other.

Structure is expressed with rules, not containers. Prefer a hairline border or a divided
list over a box; a "card" is not part of this vocabulary. Where emphasis is needed, use a
1px colored left border (never thicker), as the error state does.

Icons are authored SVG on a 16 grid with a uniform 1.5 stroke, butt caps, miter joins, no
fills. Emoji and Unicode glyphs are not an icon system.

## Components

**Masthead** — sticky, `border-b` `rule`. Left: wordmark in `label`/`ink` with a
`rule-strong` divider. Centre: nav. Right: operator email in `data`/`micro` plus a sign-out
icon button that goes `alert` on hover.

**Nav** — icon + `label` + key hint. The active surface is marked by a 1px `signal` rule
along the bottom edge and `ink` text; inactive is `ink-faint`, hover `ink-dim`. It is a
rule, never a pill or a fill. `Alt+1/2/3` jump between surfaces — `Alt` deliberately, so
plain digits stay free for filter and search fields.

**Status strip** — a `panel` band: a 1.5px square dot (`live` green or `signal` amber), the
provenance label, the explanatory sentence, and a right-aligned detail slot for age or
counts. This component is how the product's central rule stays visible.

**CommandButton / CommandLink** — a ruled rectangle, uppercase `label`, optional key hint.
`primary` is `signal` on transparent and inverts to `ground` on `signal` when hovered.
Disabled goes `ink-ghost` on a `rule` border. `CommandLink` exists so a navigating control
is an `<a>` — a `<button>` inside a `<Link>` is invalid HTML and announces as two controls.

**Empty state** — three dashed `ink-ghost` rules (the shape of the rows that are not there),
a `title` headline, `body` explanation, and one action. It sits in the same field as real
content, so an empty surface reads as an instrument with no signal, not a different page.

**Loading** — ruled skeleton rows at real row height, pulsing between `ground` and `raise`
with a 45ms per-row stagger. A terminal does not spin; it shows the rows filling.

**Error** — a 1px `alert` left rule, an `alert` `label` headline, a plain-language body that
names the recovery, and the raw message in a `panel` block. The detail wraps rather than
scrolls: it is text to read, not a data column.

**Input** — `ground` fill, `rule` border, `data` face. Border goes `rule-strong` on hover and
`signal` on focus. Global `:focus-visible` is a 1px `signal` outline at 1px offset.

## Do's and Don'ts

**Do**

- State provenance on every surface that shows data, and its age alongside it.
- Use `data` (mono, tabular) for every figure, timestamp and identifier so columns align.
- Reach for a rule before a container.
- Keep `live`, `signal` and `alert` meaning exactly one thing each.
- Give every control a keyboard path and let the global focus ring show it.
- Optimize for the tenth minute: more legible rows per screen beats more comfortable padding.

**Don't**

- Don't add a border radius. Anywhere.
- Don't add a shadow, a glass panel, or a gradient.
- Don't use `ink-ghost` for text.
- Don't use `live`/`alert` as decoration, or introduce a fourth signal color.
- Don't build cards, stat tiles, donut charts, sparklines, or progress rings.
- Don't centre content in a fixed-width column — the field is the full viewport.
- Don't let a saved lead and a search result look alike, and never let a surface imply that
  transient Google data is permanent.
- Don't put an eyebrow or kicker above a heading.
