import Link from 'next/link'

import { PrintBriefing } from '@/components/leads/prepare-call'
import type { StoredBriefing } from '@/lib/assistant/types'
import { fullDate, shortDate } from '@/lib/leads/dates'

/*
 * What to say when they pick up.
 *
 * The one surface in this product read with a phone already ringing, and it is
 * built for that and nothing else: the type is larger than anywhere else here,
 * the sentences are short, and there is not a measurement on it. Everything
 * below it on the page — the fault list, the evidence, the notebook — is what
 * this was derived from, and none of it is going to be read in the four seconds
 * before somebody says hello.
 *
 * ONE AMBER THING. DESIGN.md gives the accent exactly one meaning per surface,
 * and here it is the opening line: the words he actually says first. Every other
 * line on the sheet is ink, dim, or faint. A briefing with five amber sentences
 * is a briefing with none.
 *
 * It sits above the diagnosis because it is the answer and the diagnosis is the
 * argument, and it prints alone — see the print block in globals.css, which this
 * section's `data-print-region` is the hook for.
 */

/** The provenance line: who wrote it, from what, and how old that was. */
function Provenance({ briefing }: { briefing: StoredBriefing }) {
  const parts = [
    `prepared ${shortDate(briefing.generatedAt)}`,
    briefing.diagnosisAsOf ? `diagnosis ${shortDate(briefing.diagnosisAsOf)}` : 'no diagnosis',
    briefing.reviewCount === null
      ? 'no reviews read'
      : `${briefing.reviewCount} ${briefing.reviewCount === 1 ? 'review' : 'reviews'}`,
    // The model when there was one, the registry id when there was not. Never
    // both, and never a placeholder — see AssistantOrigin.
    briefing.model ?? briefing.provider,
  ]

  return (
    <p className="font-data text-micro text-ink-faint" title={fullDate(briefing.generatedAt)}>
      {parts.join(' · ')}
    </p>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-rule px-3 py-2.5">
      <h3 className="label text-ink-ghost">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

export function CallBriefing({ briefing }: { briefing: StoredBriefing }) {
  const { headline, opening, points, objections, ask, avoid } = briefing.briefing

  return (
    <section data-print-region aria-label="Call briefing" className="border-b border-rule-strong">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule bg-panel px-3 py-1.5">
        <h2 className="label text-ink-dim">Call briefing</h2>
        <div className="flex items-baseline gap-3">
          <Provenance briefing={briefing} />
          <PrintBriefing />
          {/*
            The way through to the assistant view. The briefing already knows
            which call it belongs to, so the link costs nothing and is the only
            place it can honestly go: the call surface is this sheet with a
            transcript running beside it.
          */}
          <Link
            href={`/calls/${briefing.callId}`}
            className="label text-ink-faint transition-colors hover:text-signal print:hidden"
          >
            Open call
          </Link>
        </div>
      </div>

      {/*
        The same guard the diagnosis carries, one level up. A briefing written
        from an audit that has since been re-run may open with a fault that is no
        longer there — and unlike the fault list, this one is built to be read
        out loud without being checked first.
      */}
      {briefing.stale ? (
        <p className="border-b border-rule border-l border-l-signal bg-panel px-3 py-2 text-sm text-ink">
          This was written from the audit of{' '}
          {briefing.diagnosisAsOf ? shortDate(briefing.diagnosisAsOf) : 'an earlier run'}, and the
          lead has been audited again since. Prepare it again before reading any of it aloud.
        </p>
      ) : null}

      <div className="border-b border-rule px-3 py-3">
        {/* Who they are and why they are worth the call. Read, not said. */}
        {headline ? <p className="max-w-[62ch] text-sm text-ink-faint">{headline}</p> : null}

        {/* The words he actually says. The largest type on the page, and the
            one amber thing on this surface. */}
        <p className="mt-1.5 max-w-[62ch] text-xl text-signal">{opening}</p>
      </div>

      {points.length ? (
        <Block title="Points">
          <ol className="space-y-2">
            {points.map((point, index) => (
              <li key={`${point.code ?? 'point'}-${index}`} className="flex items-baseline gap-2.5">
                <span className="shrink-0 font-data text-micro text-ink-ghost">{index + 1}</span>
                <span className="min-w-0">
                  <span className="label text-ink">{point.label}</span>
                  {/*
                    A point with no finding under it is marked rather than left
                    to blend in. `BriefingPoint.code` exists for exactly this:
                    the business signals and the history are legitimate things to
                    say, and they are not things the audit measured.
                  */}
                  {point.code === null ? (
                    <span className="ml-2 font-data text-micro text-ink-ghost">no finding</span>
                  ) : null}
                  <span className="mt-0.5 block max-w-[62ch] text-lg text-ink-dim">
                    {point.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      {objections.length ? (
        <Block title="If they say">
          <dl className="space-y-2">
            {objections.map((entry, index) => (
              <div key={`${entry.objection}-${index}`}>
                {/* Theirs, then his. Faint then full, so the eye lands on the answer. */}
                <dt className="max-w-[62ch] text-sm text-ink-faint">“{entry.objection}”</dt>
                <dd className="mt-0.5 max-w-[62ch] text-base text-ink-dim">{entry.reply}</dd>
              </div>
            ))}
          </dl>
        </Block>
      ) : null}

      {ask ? (
        <Block title="Before you hang up">
          <p className="max-w-[62ch] text-lg text-ink">{ask}</p>
        </Block>
      ) : null}

      {avoid.length ? (
        <Block title="Don’t">
          <ul className="space-y-1">
            {avoid.map((line) => (
              <li key={line} className="max-w-[62ch] text-sm text-ink-faint">
                {line}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
    </section>
  )
}
