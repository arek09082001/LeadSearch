import { PrintBriefing } from '@/components/leads/prepare-call'
import type { StoredBriefing } from '@/lib/assistant/types'
import { fullDate, shortDate } from '@/lib/leads/dates'

/*
 * What to say when they pick up.
 *
 * The one surface in this product read with a phone already ringing, and it is
 * built for that and nothing else: the type is larger than anywhere else here,
 * the sentences are short, and there is no measurement on it. Everything below
 * it on the page — the fault list, the evidence, the notebook — is what this was
 * derived from, and he is not going to read it in the four seconds before
 * somebody says hello.
 *
 * ONE AMBER THING. DESIGN.md gives the accent exactly one meaning per surface,
 * and here it is the strongest hook: the sentence he opens with. Every other
 * line on the sheet is ink, dim, or faint. A briefing with five amber sentences
 * would be a briefing with none.
 *
 * It sits above the diagnosis rather than beside it because it is the answer and
 * the diagnosis is the argument, and it prints alone — see the print block in
 * globals.css, which this section's `data-print-region` is the hook for.
 */

/** The provenance line: what this was built from, and how old that was. */
function Provenance({ briefing }: { briefing: StoredBriefing }) {
  const parts = [
    `prepared ${shortDate(briefing.createdAt)}`,
    briefing.diagnosisAsOf ? `diagnosis ${shortDate(briefing.diagnosisAsOf)}` : 'no diagnosis',
    briefing.reviewsAsOf
      ? `${briefing.reviewCount} ${briefing.reviewCount === 1 ? 'review' : 'reviews'} ${shortDate(briefing.reviewsAsOf)}`
      : 'no reviews read',
    briefing.model ? briefing.model : briefing.provider,
  ]

  return (
    <p className="font-data text-micro text-ink-faint" title={fullDate(briefing.createdAt)}>
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
  const { opener, hooks, evidence, objections, avoid } = briefing.briefing

  return (
    <section
      data-print-region
      aria-label="Call briefing"
      className="border-b border-rule-strong"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule bg-panel px-3 py-1.5">
        <h2 className="label text-ink-dim">Call briefing</h2>
        <div className="flex items-baseline gap-3">
          <Provenance briefing={briefing} />
          <PrintBriefing />
        </div>
      </div>

      {/*
        The same guard the diagnosis carries, one level up. A briefing written
        from an audit that has since been re-run may open with a fault that is
        no longer there — and unlike the fault list, this one is designed to be
        read out loud without being checked first.
      */}
      {briefing.stale ? (
        <p className="border-b border-rule border-l border-l-signal bg-panel px-3 py-2 text-sm text-ink">
          This was written from the audit of{' '}
          {briefing.diagnosisAsOf ? shortDate(briefing.diagnosisAsOf) : 'an earlier run'}, and the
          lead has been audited again since. Prepare it again before reading any of it aloud.
        </p>
      ) : null}

      {/* The sentences he actually says. The largest type on the page. */}
      <div className="border-b border-rule px-3 py-3">
        {opener.map((line) => (
          <p key={line} className="max-w-[62ch] text-xl text-ink [&+p]:mt-2">
            {line}
          </p>
        ))}
      </div>

      {hooks.length ? (
        <Block title={`Hooks — strongest first`}>
          <ol className="space-y-1.5">
            {hooks.map((hook, index) => (
              <li key={`${hook.code ?? 'hook'}-${index}`} className="flex items-baseline gap-2.5">
                <span className="shrink-0 font-data text-micro text-ink-ghost">{index + 1}</span>
                <span
                  className={`max-w-[62ch] text-lg ${index === 0 ? 'text-signal' : 'text-ink-dim'}`}
                >
                  {hook.text}
                </span>
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      {evidence.length ? (
        <Block title="Say the numbers">
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {evidence.map((item) => (
              <div key={`${item.label}-${item.value}`} className="flex items-baseline gap-1.5">
                <dt className="text-sm text-ink-faint">{item.label}</dt>
                <dd className="font-data text-sm text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
        </Block>
      ) : null}

      {objections.length ? (
        <Block title="If they say">
          <dl className="space-y-2">
            {objections.map((entry) => (
              <div key={entry.objection}>
                {/* Theirs, then his. Faint then full, so the eye lands on the answer. */}
                <dt className="max-w-[62ch] text-sm text-ink-faint">“{entry.objection}”</dt>
                <dd className="mt-0.5 max-w-[62ch] text-base text-ink-dim">{entry.answer}</dd>
              </div>
            ))}
          </dl>
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
