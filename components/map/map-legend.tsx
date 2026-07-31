'use client'

import { COLD_SCORE_FLOOR } from '@/lib/leads/types'
import { MAP_COLORS, scoreColor } from '@/lib/map/palette'

/*
 * What the colours mean, said once, on the surface that uses them.
 *
 * The rest of the product can afford to leave its encoding implicit because a
 * table names its columns. A map has no headers: a field of dots is unreadable
 * until somebody says that amber is the book and green is Google, and that is
 * exactly the distinction PRODUCT.md refuses to let any surface blur. So this is
 * the map's column headers rather than decoration, and it is the smallest thing
 * that can do that job.
 *
 * The swatches are squares while the marks on the canvas are circles, and that
 * is on purpose. What this legend explains is colour; shape carries nothing
 * here. A round swatch would be the only rounded thing in the entire product for
 * the sake of a resemblance nobody is checking, and DESIGN.md is unambiguous
 * about which of those two costs more. The status strip's provenance dot is a
 * square for the same reason and has been all along.
 */

function Swatch({ color, hollow }: { color: string; hollow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0"
      style={
        hollow
          ? { border: `1px solid ${color}`, backgroundColor: 'transparent' }
          : { backgroundColor: color }
      }
    />
  )
}

export function MapLegend({ live }: { live: boolean }) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-2 z-10 hidden border border-rule-strong bg-ground/95 sm:block">
      <div className="flex items-center gap-2 border-b border-rule px-2.5 py-1">
        <span aria-hidden="true" className="size-1.5 bg-signal" />
        <span className="label text-ink-dim">Book</span>
        <span className="flex items-center gap-1">
          <Swatch color={scoreColor(10)} />
          <Swatch color={scoreColor(COLD_SCORE_FLOOR)} />
          <Swatch color={scoreColor(100)} />
        </span>
        <span className="font-data text-micro text-ink-faint">score 0–100</span>
        <span aria-hidden="true" className="h-3 w-px bg-rule-strong" />
        <Swatch color={MAP_COLORS.inkFaint} hollow />
        <span className="font-data text-micro text-ink-faint">not audited</span>
      </div>

      {live ? (
        <div className="flex items-center gap-2 border-b border-rule px-2.5 py-1">
          <span aria-hidden="true" className="size-1.5 bg-live" />
          <span className="label text-ink-dim">Live</span>
          <Swatch color={MAP_COLORS.live} />
          <span className="font-data text-micro text-ink-faint">Google result</span>
          <span aria-hidden="true" className="h-3 w-px bg-rule-strong" />
          <span aria-hidden="true" className="border border-signal p-px">
            <span className="block size-1.5" style={{ backgroundColor: MAP_COLORS.live }} />
          </span>
          <span className="font-data text-micro text-ink-faint">selected</span>
        </div>
      ) : null}

      <p className="px-2.5 py-1 font-data text-micro text-ink-faint">
        click the field to set a search centre · drag the ring for radius
      </p>
    </div>
  )
}
