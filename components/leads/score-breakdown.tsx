import { SEVERITY_TONE } from '@/components/leads/tone'
import { FINDING_SPECS, isFindingCode, type FindingSeverity } from '@/lib/enrichment/vocabulary'
import type { ScoreFactor, StoredScore } from '@/lib/scoring/score'

/*
 * Why this lead is an 84.
 *
 * The number on its own is an assertion, and an assertion is the one thing the
 * operator cannot use: he is about to phone a stranger on the strength of it,
 * and a ranking he cannot interrogate is a ranking he will stop trusting the
 * first time it puts a bad lead on top. So the arithmetic is on the page — every
 * fault with what it was worth, what the diminishing rule left of it, which
 * business tier was matched, and the multiplier that came out.
 *
 * It reads top-down as the calculation actually runs: faults, total, strength,
 * signal, score. Nothing is summarised into a phrase that hides a number.
 *
 * No colour beyond the severity brightness the diagnosis already uses. This is
 * the same vocabulary as the fault list below it — a critical sits at full ink
 * and an informative one recedes — because the score is a reading of those
 * findings and must not look like a separate opinion.
 */

function shortDate(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getFullYear()).slice(2)}`
}

/** `12.5` but `45`, never `45.00`. The column is narrow and the zeros say nothing. */
function points(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/*
 * The breakdown comes back out of a jsonb column, so its severity is a string
 * that was a FindingSeverity when it was written and is only typed as one now.
 * A vocabulary that dropped a level would otherwise put `undefined` into a
 * className and render the fault at whatever the cascade felt like.
 */
function tone(severity: string): string {
  return SEVERITY_TONE[severity as FindingSeverity] ?? 'text-ink-dim'
}

function Factor({ factor, rank }: { factor: ScoreFactor; rank: number }) {
  const spec = isFindingCode(factor.code) ? FINDING_SPECS[factor.code] : null

  return (
    <li className="flex items-baseline gap-2 px-3 py-1">
      <span className={`label w-24 shrink-0 truncate ${tone(factor.severity)}`}>
        {spec?.mark ?? factor.code}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm text-ink-dim" title={factor.label}>
        {spec?.label ?? factor.label}
      </span>

      {/*
        The discount, stated rather than implied. The first fault keeps its full
        weight and the ones under it are worth half of the last — which is the
        single most surprising thing about this arithmetic, and the operator
        will want to see it happening rather than read about it in a config file.
      */}
      {rank > 0 ? (
        <span className="shrink-0 font-data text-micro text-ink-faint">
          {points(factor.weight)} × {factor.retained}
        </span>
      ) : null}

      <span className="w-10 shrink-0 text-right font-data text-micro text-ink-dim">
        {points(factor.contribution)}
      </span>
    </li>
  )
}

/** One line of the sum, so the arithmetic reads as arithmetic. */
function Step({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-1">
      <dt className={`label flex-1 ${strong ? 'text-ink-dim' : 'text-ink-faint'}`}>{label}</dt>
      <dd
        className={`shrink-0 font-data ${strong ? 'text-sm text-ink' : 'text-micro text-ink-dim'}`}
      >
        {value}
      </dd>
    </div>
  )
}

export function ScoreBreakdown({ score }: { score: StoredScore | null }) {
  /*
   * Never scored is not scored zero, and the two must never look alike. One
   * means the pass has not reached this lead; the other is a verdict.
   */
  if (!score) {
    return (
      <>
        <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-ghost">Score</h2>
        <p className="max-w-[52ch] border-b border-rule px-3 py-3 text-sm text-ink-faint">
          Not scored yet. A lead is ranked once its audit has finished, PageSpeed included — and
          an audit that failed outright is left unranked rather than scored zero, because a check
          that could not run has not found the site to be fine.
        </p>
      </>
    )
  }

  const breakdown = score.breakdown

  return (
    <>
      <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-ghost">Score</h2>

      <div className="flex items-baseline gap-3 border-b border-rule px-3 py-2.5">
        {score.score === null ? (
          <span className="font-data text-xl text-ink-faint" title="Excluded from the ranking">
            —
          </span>
        ) : (
          <span className="font-data text-2xl text-ink">{score.score}</span>
        )}

        <span className="min-w-0 flex-1 font-data text-micro text-ink-faint">
          {breakdown?.signal.label ?? 'Scored'}
        </span>
      </div>

      {/*
        Exclusion is stated in words, not left to the em dash above. It is a
        deliberate act by the scorer and the operator is entitled to know which
        rule performed it — otherwise a business simply goes missing from his
        list and he has no way to find out why.
      */}
      {breakdown?.excluded ? (
        <p className="max-w-[52ch] border-b border-rule px-3 py-2 text-sm text-ink-dim">
          {breakdown.excluded.reason}
        </p>
      ) : null}

      {breakdown ? (
        <>
          {breakdown.factors.length ? (
            <ul className="border-b border-rule">
              {breakdown.factors.map((factor, index) => (
                <Factor key={factor.code} factor={factor} rank={index} />
              ))}
            </ul>
          ) : (
            <p className="border-b border-rule px-3 py-2 text-sm text-ink-faint">
              No faults to score. Nothing this audit checked came back wrong.
            </p>
          )}

          <dl className="border-b border-rule">
            <Step
              label={`Points of ${points(breakdown.scale.fullScale)}`}
              value={points(breakdown.points)}
            />
            <Step label="Strength" value={`${breakdown.strength} / 100`} />
            <Step
              label={`${breakdown.signal.rating ?? '—'}★ · ${breakdown.signal.reviews ?? 'no'} reviews`}
              value={`× ${breakdown.signal.multiplier}`}
            />
            <Step
              label="Score"
              value={score.score === null ? 'withheld' : String(score.score)}
              strong
            />
          </dl>
        </>
      ) : (
        <p className="border-b border-rule px-3 py-2 text-sm text-ink-faint">
          This score was written under an older breakdown shape and cannot show its arithmetic.
          Re-rank the book and it will explain itself.
        </p>
      )}

      {/*
        Which version of the weights produced this, and when. It is the whole
        reason old scores stay readable after an afternoon of tuning — and the
        first thing to check when a number looks wrong.
      */}
      <p className="px-3 py-1.5 font-data text-micro text-ink-faint">
        config {score.configVersion} · {shortDate(score.computedAt)}
      </p>
    </>
  )
}
