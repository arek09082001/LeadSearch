'use client'

import { useEffect, useState } from 'react'

import { IconCheck, IconClose, IconExternal, IconPlus, IconPulse } from '@/components/icons'
import { SEVERITY_TONE } from '@/components/leads/tone'
import { CommandButton, CommandLink } from '@/components/ui/command-button'
import { FINDING_SPECS, sortCodes } from '@/lib/enrichment/vocabulary'
import { ago } from '@/lib/leads/dates'
import { NEVER_AUDITED, type LeadDetail, type LeadPoint, type LeadRow } from '@/lib/leads/types'
import { scoreColor } from '@/lib/map/palette'
import { formatPlaceType } from '@/lib/places-types'
import type { SearchRow } from '@/lib/search/types'

/*
 * What is under the mark you just clicked.
 *
 * A panel and not a popup, and that is the whole design of it. A popup on a map
 * covers the neighbours — which on this surface are the comparison being made —
 * and it takes its shape from the point rather than from the page, so it can
 * never be a column of aligned figures. This is a ruled column beside the field,
 * the same way every other secondary reading surface in the product is.
 *
 * It is deliberately not the lead's page. Name, score, what is broken, a number
 * to ring: enough to decide whether this is the call to make next. The page
 * itself is one click away and is where the evidence lives.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-rule px-3 py-1.5">
      <span className="label w-16 shrink-0 text-ink-faint">{label}</span>
      <span className="min-w-0 flex-1 text-sm wrap-anywhere text-ink-dim">{children}</span>
    </div>
  )
}

function Header({
  provenance,
  title,
  onClose,
}: {
  provenance: 'book' | 'live'
  title: string
  onClose: () => void
}) {
  return (
    <div className="border-b border-rule bg-panel px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="label flex items-center gap-1.5 text-ink-dim">
            <span
              aria-hidden="true"
              className={`size-1.5 ${provenance === 'book' ? 'bg-signal' : 'bg-live'}`}
            />
            {provenance === 'book' ? 'Book · saved lead' : 'Live · Google result'}
          </span>
          <h2 className="mt-1 text-lg font-semibold wrap-anywhere text-ink">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the panel"
          className="-mr-1 shrink-0 p-1 text-ink-faint transition-colors hover:text-ink"
        >
          <IconClose className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/** The audit's verdict, as the marks the table uses, so the two cannot disagree. */
function Findings({ flags }: { flags: string[] }) {
  if (flags.includes(NEVER_AUDITED) || flags.length === 0) {
    return <span className="label text-ink-faint">Not audited yet</span>
  }

  const codes = sortCodes(flags)
  if (!codes.length) return <span className="label text-ink-faint">Nothing found</span>

  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {codes.map((code) => (
        <span
          key={code}
          className={`label ${SEVERITY_TONE[FINDING_SPECS[code].severity]}`}
          title={FINDING_SPECS[code].label}
        >
          {FINDING_SPECS[code].mark}
        </span>
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------------- *
 * A saved lead
 * ------------------------------------------------------------------------- */

function LeadBody({ point, onClose }: { point: LeadPoint; onClose: () => void }) {
  const [lead, setLead] = useState<LeadRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * A different mark means a different lead, so the fetched half is dropped
   * before the new one arrives. Adjusted during render rather than in an effect,
   * the way the library's console and filter bar do it: an effect would let one
   * frame paint the previous lead's phone number under this lead's name.
   */
  const [lastId, setLastId] = useState(point.id)
  if (lastId !== point.id) {
    setLastId(point.id)
    setLead(null)
    setError(null)
  }

  /*
   * The point carries what a map needs; the phone number is not that.
   *
   * `queryLeadPoints` ships six fields for up to two thousand pins on purpose,
   * so the number to ring is fetched for the one lead being read rather than
   * for every lead on screen. What the point already knows is drawn immediately
   * and never replaced — the panel fills in, it does not flash.
   */
  useEffect(() => {
    const controller = new AbortController()

    fetch(`/api/leads/${point.id}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error ?? 'That lead could not be read.')
        setLead((body as LeadDetail).lead)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'That lead could not be read.')
      })

    return () => controller.abort()
  }, [point.id])

  const phone = lead?.imprintPhone ?? lead?.phone ?? null

  return (
    <>
      <Header provenance="book" title={point.name} onClose={onClose} />

      <div className="flex items-baseline gap-2 border-b border-rule px-3 py-2">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 self-center"
          style={{ backgroundColor: scoreColor(point.score) }}
        />
        <span className="font-data text-lg text-ink">{point.score ?? '—'}</span>
        <span className="label text-ink-faint">
          {point.score === null ? 'Not scored yet' : 'Score'}
        </span>
        <span className="label ml-auto text-ink-dim">{point.status}</span>
      </div>

      <Row label="Broken">
        <Findings flags={point.auditFlags} />
      </Row>

      <Row label="Phone">
        {lead ? (
          phone ? (
            // A number on a map is a number to ring, so it is one tap on the
            // phone this product is also read on.
            <a href={`tel:${phone}`} className="font-data text-ink hover:text-signal">
              {phone}
            </a>
          ) : (
            <span className="text-ink-faint">None known</span>
          )
        ) : error ? (
          <span className="text-ink-faint">{error}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-ink-faint">
            <IconPulse className="size-3.5 animate-pulse" />
            Reading
          </span>
        )}
      </Row>

      {lead?.city || lead?.formattedAddress ? (
        <Row label="Where">{lead.formattedAddress ?? lead.city}</Row>
      ) : null}

      {lead?.primaryType ? <Row label="Trade">{formatPlaceType(lead.primaryType)}</Row> : null}

      {/* Principle 5: the Google-sourced fields above say how old they are. */}
      {lead ? (
        <Row label="Snapshot">
          <span className="font-data text-micro text-ink-faint">{ago(lead.fetchedAt)}</span>
        </Row>
      ) : null}

      <div className="p-3">
        <CommandLink href={`/leads/${point.id}`} variant="primary">
          Open lead
          <IconExternal className="size-3.5" />
        </CommandLink>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * A live result
 * ------------------------------------------------------------------------- */

function ResultBody({
  row,
  selected,
  onToggle,
  onClose,
}: {
  row: SearchRow
  selected: boolean
  onToggle: () => void
  onClose: () => void
}) {
  return (
    <>
      <Header provenance="live" title={row.name ?? 'Unnamed business'} onClose={onClose} />

      {/*
        The thesis, stated first. Everything else on this panel is context for
        whether a business with no website is worth the call.
      */}
      <Row label="Website">
        {row.website ? (
          <a
            href={row.website}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-ink-dim hover:text-signal"
          >
            <span className="truncate">{row.website.replace(/^https?:\/\//, '')}</span>
            <IconExternal className="size-3 shrink-0" />
          </a>
        ) : (
          <span className="label text-ink">No website</span>
        )}
      </Row>

      <Row label="Phone">
        {row.phone ? (
          <a href={`tel:${row.phone}`} className="font-data text-ink hover:text-signal">
            {row.phone}
          </a>
        ) : (
          <span className="text-ink-faint">None given</span>
        )}
      </Row>

      {row.formattedAddress ? <Row label="Where">{row.formattedAddress}</Row> : null}
      {row.primaryType ? <Row label="Trade">{formatPlaceType(row.primaryType)}</Row> : null}

      {row.rating !== null ? (
        <Row label="Rating">
          <span className="font-data text-ink">{row.rating.toFixed(1)}</span>
          <span className="ml-1.5 font-data text-micro text-ink-faint">
            {row.userRatingCount ?? 0} reviews
          </span>
        </Row>
      ) : null}

      <Row label="Fetched">
        <span className="font-data text-micro text-ink-faint">{ago(row.fetchedAt)}</span>
      </Row>

      <div className="flex flex-col gap-2 p-3">
        {row.savedLeadId ? (
          <>
            <p className="text-sm text-ink-dim">
              Already in the book. Saving it again refreshes the Google fields on the
              lead you already have.
            </p>
            <CommandLink href={`/leads/${row.savedLeadId}`}>
              Open the saved lead
              <IconExternal className="size-3.5" />
            </CommandLink>
          </>
        ) : null}

        <CommandButton
          type="button"
          variant={selected ? 'default' : 'primary'}
          onClick={onToggle}
        >
          {selected ? (
            <>
              <IconCheck className="size-3.5" />
              Selected — click to drop
            </>
          ) : (
            <>
              <IconPlus className="size-3.5" />
              Select for saving
            </>
          )}
        </CommandButton>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * The panel
 * ------------------------------------------------------------------------- */

export function MapPanel({
  point,
  result,
  selected,
  onToggleResult,
  onClose,
}: {
  point: LeadPoint | null
  result: SearchRow | null
  selected: boolean
  onToggleResult: () => void
  onClose: () => void
}) {
  if (!point && !result) return null

  return (
    <aside
      aria-label="The mark you selected"
      className="max-h-[46vh] shrink-0 overflow-y-auto border-t border-rule bg-ground lg:max-h-none lg:w-[19rem] lg:border-t-0 lg:border-l"
    >
      {result ? (
        <ResultBody
          row={result}
          selected={selected}
          onToggle={onToggleResult}
          onClose={onClose}
        />
      ) : point ? (
        <LeadBody point={point} onClose={onClose} />
      ) : null}
    </aside>
  )
}
