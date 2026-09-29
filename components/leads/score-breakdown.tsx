import { SEVERITY_TONE } from '@/components/leads/tone'
import { FINDING_SPECS, isFindingCode, type FindingSeverity } from '@/lib/enrichment/vocabulary'
import { shortDate } from '@/lib/leads/dates'
import type { ScoreFactor, ScoreMovement, StoredScore } from '@/lib/scoring/score'

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

/**
 * How the score got here from wherever it was.
 *
 * The case this exists for, in full: a lead sits at 94 because it has no
 * website. The refresh pass finds that it now has one. The audit is re-run, the
 * `no_website` fault — 45 of the 65 points on the scale — is gone, and the lead
 * comes back at 31. Every step of that is correct and none of it is visible: the
 * operator remembers a 94, finds a 31, and has no way to tell a business that
 * fixed its website from a scorer that broke.
 *
 * So the movement is stated, with the faults that moved it named in the same
 * vocabulary the diagnosis above uses. "Fixed: No website at all" IS the
 * sentence "they built a website", said in the words the rest of the product
 * already speaks — and derived from the stored arithmetic rather than from a
 * second record of what happened, so it cannot disagree with the number.
 *
 * The direction is carried by the sign and the word, never by red and green.
 * `alert` in this product means failure and destructive intent, and a lead
 * getting better is neither.
 */
function Movement({ movement }: { movement: ScoreMovement }) {
  const { delta } = movement

  /*
   * A score can move its reasoning without moving its number — one fault
   * swapped for another worth the same. "Level 0" is not a sentence anybody
   * writes; the interesting part is the two lines underneath, and this line
   * should get out of their way rather than put a zero in front of them.
   */
  const heading =
    delta === null
      ? 'Score withheld'
      : delta === 0
        ? 'Same score, different faults'
        : `${delta < 0 ? 'Down' : 'Up'} ${Math.abs(delta)}`

  return (
    <div className="border-b border-rule px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="label text-ink-dim">{heading}</span>
        <span className="font-data text-micro text-ink-faint">
          {movement.from ?? '—'} → {movement.to ?? '—'} · {shortDate(movement.when)}
        </span>
      </div>

      {/*
        Faults that went away, first. That is the direction that costs him a
        lead, and it is the one he will not otherwise believe.
      */}
      {movement.fixed.length ? (
        <p className="mt-1 max-w-[52ch] text-sm text-ink">
          <span className="label text-ink-faint">Fixed</span>{' '}
          {movement.fixed.map((factor) => label(factor)).join(', ')}.
        </p>
      ) : null}

      {movement.appeared.length ? (
        <p className="mt-1 max-w-[52ch] text-sm text-ink-dim">
          <span className="label text-ink-faint">New</span>{' '}
          {movement.appeared.map((factor) => label(factor)).join(', ')}.
        </p>
      ) : null}

      {/*
        A score that moved because the weights moved is not a score that moved
        because the business did, and confusing the two would send him out to
        call somebody about a config edit.
      */}
      {movement.configChanged ? (
        <p className="mt-1 max-w-[52ch] text-sm text-ink-faint">
          The weights changed between these two scores, so some of this movement is the
          ranking, not the business.
        </p>
      ) : null}
    </div>
  )
}

function label(factor: ScoreFactor): string {
  return isFindingCode(factor.code) ? FINDING_SPECS[factor.code].label : factor.label
}

export function ScoreBreakdown({
  score,
  movement,
}: {
  score: StoredScore | null
  movement: ScoreMovement | null
}) {
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

      {/*
        Directly under the number, above the arithmetic. The question "why has
        this moved" comes before "how was it computed", and a movement buried
        beneath twenty lines of factors is one he would only find by looking for
        it — which is exactly what he cannot do, because he does not yet know
        anything moved.
      */}
      {movement ? <Movement movement={movement} /> : null}

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
