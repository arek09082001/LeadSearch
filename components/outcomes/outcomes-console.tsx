import { Fragment } from 'react'

import { SEVERITY_TONE } from '@/components/leads/tone'
import { StatusStrip } from '@/components/shell/status-strip'
import { CommandLink } from '@/components/ui/command-button'
import { EmptyState } from '@/components/ui/states'
import type { BandOutcome, CodeOutcome, OutcomeReport, Tally } from '@/lib/insight/outcomes'

/*
 * Which diagnosis actually sells.
 *
 * The one surface in this product that looks backwards. Everything else ranks
 * leads by what the weights say they are worth; this asks whether the weights
 * were right — how often each fault was on a lead that got called, and how those
 * calls ended.
 *
 * IT IS A TABLE, AND THAT IS THE DESIGN DECISION. DESIGN.md forbids charts,
 * stat tiles and progress rings, and this is the page that would have grown all
 * three. It is also the page where they would do the most damage: a bar drawn
 * from four phone calls reads as a finding, and the operator would go and edit a
 * weight on the strength of it. So the comparison is carried by the ordering and
 * by contrast — the rows worth reading are at the top and at full brightness,
 * the rest are dimmer and below a rule — and every rate sits next to the number
 * of decided leads it was computed from.
 *
 * Nothing here is interactive, and there is nothing to save. The page ends in a
 * decision the operator makes somewhere else: a line in lib/scoring/config.ts,
 * typed by hand, under a bumped version. That is stated at the foot of the page
 * rather than implied, because an analysis screen with no buttons is exactly the
 * kind of thing that later grows an "apply" one.
 */

/** `42%`. A rate the sample cannot support is still rendered — beside its count. */
function percent(rate: number | null): string {
  if (rate === null) return '—'
  return `${Math.round(rate * 100)}%`
}

/**
 * What the rate was computed from, in words, on every single row.
 *
 * The operator's rule, and the reason this column is not optional: under the
 * floor the page shows the number AND says it means nothing, in the same glance.
 * A rate with no sample beside it is an invitation to re-tune the ranking from
 * four phone calls.
 */
function reading(tally: Tally, floor: number): string {
  if (tally.decided === 0) return 'nothing decided yet'
  if (tally.reliable) return `${tally.decided} decided`
  return `${tally.decided} of ${floor} decided — too few to read`
}

/*
 * A count. Several of them carry `hidden md:table-cell`, and that is the phone
 * layout's one decision: at 390px the columns do not all fit, and the pair that
 * must survive is the rate and the sample it was computed from. The won/lost
 * split is the desk's detail — the sentence "13 of 30 decided — too few to read"
 * is the part that stops a number being misread, so it is the part that stays.
 */
function Cell({
  value,
  dim,
  className = '',
}: {
  value: number
  dim?: boolean
  className?: string
}) {
  return (
    <td
      className={`px-2 py-1.5 text-right font-data text-micro ${
        dim ? 'text-ink-faint' : ''
      } ${className}`}
    >
      {/* A zero is a real count here and is written as one. */}
      {value}
    </td>
  )
}

/**
 * The tail of every row: the rate, then what it rests on.
 *
 * Brightness is the whole signal. A rate over enough decided leads sits at full
 * ink; one under the floor recedes to the same tone the page uses for a fault it
 * cannot sell on. No colour is spent — `live` and `alert` each already mean one
 * thing, and a closing rate is neither a failure nor a live feed.
 */
function Rate({ tally, floor }: { tally: Tally; floor: number }) {
  return (
    <>
      <td
        className={`px-2 py-1.5 text-right font-data text-sm ${
          tally.reliable ? 'text-ink' : 'text-ink-faint'
        }`}
      >
        {percent(tally.rate)}
      </td>
      <td className="px-2 py-1.5 font-data text-micro text-ink-faint">{reading(tally, floor)}</td>
    </>
  )
}

function CodeRow({ row, floor }: { row: CodeOutcome; floor: number }) {
  const dim = !row.reliable

  return (
    <tr className={dim ? 'text-ink-faint' : 'text-ink-dim'}>
      <th scope="row" className="px-2 py-1.5 pl-3 text-left font-normal">
        <span className={`label ${dim ? 'text-ink-faint' : SEVERITY_TONE[row.severity]}`}>
          {row.mark}
        </span>
      </th>

      <td className="hidden px-2 py-1.5 text-sm lg:table-cell">{row.label}</td>

      {/*
        What the config pays for this fault today, next to what it sold for. The
        two columns being readable against each other is the entire page: a code
        worth 45 points that closes at eight per cent is the argument, and a code
        worth 2 that closes at forty is the same argument the other way up.
      */}
      <td className="hidden px-2 py-1.5 text-right font-data text-micro md:table-cell">
        {row.weight ?? '—'}
      </td>

      <Cell value={row.worked} />
      <Cell value={row.open} dim className="hidden md:table-cell" />
      <Cell value={row.won} className="hidden md:table-cell" />
      <Cell value={row.lost} className="hidden md:table-cell" />
      <Rate tally={row} floor={floor} />
    </tr>
  )
}

function BandRow({ row, floor }: { row: BandOutcome; floor: number }) {
  return (
    <tr className={row.reliable ? 'text-ink-dim' : 'text-ink-faint'}>
      <th scope="row" className="px-2 py-1.5 pl-3 text-left font-normal">
        <span className="font-data text-sm">{row.label}</span>
      </th>

      <Cell value={row.worked} />
      <Cell value={row.open} dim className="hidden md:table-cell" />
      <Cell value={row.won} className="hidden md:table-cell" />
      <Cell value={row.lost} className="hidden md:table-cell" />
      <Rate tally={row} floor={floor} />
    </tr>
  )
}

function Heading({ title, note }: { title: string; note: string }) {
  return (
    <>
      <h2 className="label border-y border-rule bg-panel px-3 py-1.5 text-ink-faint">{title}</h2>
      <p className="max-w-[72ch] px-3 pt-2 pb-1.5 text-sm text-ink-faint">{note}</p>
    </>
  )
}

/** A column header. `data`-aligned counts get right-aligned labels above them. */
function Head({ label, className = '' }: { label: string; className?: string }) {
  return (
    <th scope="col" className={`label px-2 py-1.5 font-semibold text-ink-faint ${className}`}>
      {label}
    </th>
  )
}

export function OutcomesConsole({ report }: { report: OutcomeReport }) {
  const { overall, codes, bands, floor } = report

  if (overall.worked === 0) {
    return (
      <>
        <StatusStrip provenance="book" detail="nothing worked yet" />
        <EmptyState
          headline="No calls to read yet"
          body="This page compares what the audit found with how the call went, and it needs calls. A lead sitting on new says nothing about the weights — only that it has not been rung. Work the queue and come back."
          action={
            <CommandLink href="/outreach" variant="primary">
              Open the queue
            </CommandLink>
          }
        />
      </>
    )
  }

  // Where the readable rows stop and the ones with too little evidence begin.
  // Rendered as a rule with a sentence on it rather than left to be inferred
  // from the dimmer text above it.
  const firstUnreliable = codes.findIndex((row) => !row.reliable)
  const showsDivider = firstUnreliable > 0

  return (
    <>
      <StatusStrip
        provenance="book"
        detail={`${overall.worked} worked · ${overall.decided} decided`}
      />

      <div className="flex-1 overflow-auto">
        <section>
          <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-faint">Sample</h2>

          <p className="px-3 py-2 font-data text-sm text-ink-dim">
            <span className="text-ink">{overall.worked}</span> worked ·{' '}
            <span className="text-ink">{overall.won}</span> won ·{' '}
            <span className="text-ink">{overall.lost}</span> lost · {overall.open} still open ·
            closed{' '}
            <span className={overall.reliable ? 'text-ink' : 'text-ink-faint'}>
              {percent(overall.rate)}
            </span>
          </p>

          {/*
            The sentence that decides whether the rest of the page is evidence.
            It comes first, at full ink when the answer is "not yet", because the
            operator is about to read two tables of percentages and this is the
            one thing that changes what they are worth.
          */}
          {overall.reliable ? (
            <p className="max-w-[72ch] px-3 pb-2.5 text-sm text-ink-faint">
              {overall.decided} decided leads. Every rate here is won ÷ decided — a lead still in
              flight is not counted as a loss, because it is not one yet.
            </p>
          ) : (
            <p className="max-w-[72ch] px-3 pb-2.5 text-sm text-ink">
              Too early to read: {overall.decided} decided {overall.decided === 1 ? 'lead' : 'leads'}{' '}
              against a floor of {floor}. The counts below are real; the percentages beside them are
              arithmetic, not evidence. Nothing on this page is a reason to change a weight yet.
            </p>
          )}
        </section>

        <section>
          <Heading
            title="By finding code"
            note="How often each fault was on a lead that actually got called, and how those calls ended. Points is what the ranking pays for that fault today, so it can be read against the rate beside it. A lead carries several faults at once and is counted in every row its diagnosis held, so these rates do not add up to anything and none of them is the work of one code on its own."
          />

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule-strong">
                <Head label="Code" className="w-28 pl-3 md:w-40" />
                <Head label="Fault" className="hidden w-[34rem] lg:table-cell" />
                <Head label="Points" className="hidden w-16 text-right md:table-cell" />
                <Head label="Called" className="w-16 text-right" />
                <Head label="Open" className="hidden w-14 text-right md:table-cell" />
                <Head label="Won" className="hidden w-14 text-right md:table-cell" />
                <Head label="Lost" className="hidden w-14 text-right md:table-cell" />
                <Head label="Closed" className="w-16 text-right" />
                <Head label="Sample" />
              </tr>
            </thead>

            <tbody className="divide-y divide-rule">
              {/*
                Worked leads with nothing readable to attribute them to. Said in
                a row rather than left as an empty table, because a table with a
                header and no rows reads as "no faults", which is the opposite of
                what it means.
              */}
              {codes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-2 text-sm text-ink-faint">
                    None of the worked leads carries a diagnosis this build can read, so there is
                    nothing to compare yet.
                  </td>
                </tr>
              ) : null}

              {codes.map((row, index) => (
                <Fragment key={row.code}>
                  {showsDivider && index === firstUnreliable ? (
                    <tr className="border-t border-rule-strong">
                      <td colSpan={9} className="px-3 py-1.5 text-sm text-ink-faint">
                        Below the line: fewer than {floor} decided leads. Ordered by how much
                        evidence they have, because their rates cannot be ranked.
                      </td>
                    </tr>
                  ) : null}
                  <CodeRow row={row} floor={floor} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <Heading
            title="By score band"
            note="The same calls, banded by the score the lead was carrying when it was rung — not by what it scores today. If the ranking works, the top bands close better than the bottom ones; if they do not, the scale is sorting the book by something other than who buys."
          />

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule-strong">
                <Head label="Band" className="w-24 pl-3" />
                <Head label="Called" className="w-16 text-right" />
                <Head label="Open" className="hidden w-14 text-right md:table-cell" />
                <Head label="Won" className="hidden w-14 text-right md:table-cell" />
                <Head label="Lost" className="hidden w-14 text-right md:table-cell" />
                <Head label="Closed" className="w-16 text-right" />
                <Head label="Sample" />
              </tr>
            </thead>

            <tbody className="divide-y divide-rule">
              {bands.map((row) => (
                <BandRow key={row.key} row={row} floor={floor} />
              ))}
            </tbody>
          </table>
        </section>

        {/*
          The provenance of the numbers above, in the same place every time. Each
          line is here because without it a rate could be read as something it is
          not — which on this page is the only kind of bug that matters.
        */}
        <section className="border-t border-rule">
          <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-faint">
            How this was counted
          </h2>

          <ul className="max-w-[72ch] divide-y divide-rule text-sm text-ink-faint">
            <li className="px-3 py-2">
              Only leads that were actually reached out to. A lead on <em>new</em> is not a lead that
              said no — it is one that has not been rung — and counting it would make every fault
              look worse the more of the book goes unworked.
            </li>

            <li className="px-3 py-2">
              The diagnosis and the score used are the ones the lead carried when it was first
              contacted, read back out of the append-only score history.
              {report.rescoredSince > 0 ? (
                <>
                  {' '}
                  {report.rescoredSince} of these leads{' '}
                  {report.rescoredSince === 1 ? 'has' : 'have'} been scored again since — a re-audit,
                  or a change to the weights — and the newer score is deliberately not what is
                  counted here.
                </>
              ) : null}
            </li>

            {report.configVersions.length > 1 ? (
              <li className="px-3 py-2">
                These calls were made against {report.configVersions.length} versions of the weights
                ({report.configVersions.join(', ')}), so the bands are not one scale end to end. A
                70 under one version is not a 70 under another.
              </li>
            ) : null}

            {report.withoutDiagnosis > 0 ? (
              <li className="px-3 py-2">
                {report.withoutDiagnosis} worked{' '}
                {report.withoutDiagnosis === 1 ? 'lead has' : 'leads have'} no readable diagnosis
                from that moment — never scored, or scored under an older breakdown shape.{' '}
                {report.withoutDiagnosis === 1 ? 'It counts' : 'They count'} in the sample and in the
                bands, and in no finding code.
              </li>
            ) : null}

            {report.unseen.length > 0 ? (
              <li className="px-3 py-2">
                Never seen on a worked lead, so absent above rather than scoring zero:{' '}
                {report.unseen.map((entry) => entry.mark).join(', ')}.
              </li>
            ) : null}

            {/*
              The last word on the page, and the point of it. This surface reads;
              it does not tune. The day it grows a control that edits a weight is
              the day a rate from four calls can change the ranking of the whole
              book without anyone deciding that it should.
            */}
            <li className="px-3 py-2">
              Nothing here changes a weight. If a fault has earned a different number, that is a line
              in <span className="font-data text-micro">lib/scoring/config.ts</span>, a bumped{' '}
              <span className="font-data text-micro">version</span>, and a rescore.
            </li>
          </ul>
        </section>
      </div>
    </>
  )
}
