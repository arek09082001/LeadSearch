#!/usr/bin/env node
/*
 * Play the calls and watch the tips appear.
 *
 *   node scripts/tips-demo.mjs           (ten times speed, about half a minute)
 *   node scripts/tips-demo.mjs --live    (in real time, as the calls run)
 *
 * The whole acceptance criterion, at a terminal: the conversations go past, and
 * at the right moments exactly one short tip appears. No database, no browser,
 * no microphone — which is possible only because the trigger is a pure function,
 * and is the best argument for having made it one.
 *
 * TWO CALLS, AND THE SECOND ONE IS REAL. `SPEAKERPHONE_CALL` is written and
 * walks deliberately through four triggers; `LOGISTICS_CALL` is a transcript of
 * an actual run and walks through whatever it happens to contain, which is the
 * only way to find out that a rule list has a hole in it. It had one: under the
 * first version of the rules that entire call produced a single tip. The
 * expectations below are per call and are listed with each.
 *
 * IT GOES THROUGH THE REAL RECOGNISER, not the fixture array. The lines arrive
 * from `MockTranscriptProvider`, one at a time, interim guesses first and final
 * text after — which is what the surface actually receives, and the only way to
 * check the two things reading the fixture directly would skip: that tips fire
 * on final text and never on a half-finished guess, and that `atMs` is the
 * provider's rather than something this script made up.
 *
 * AND IT TICKS THE CLOCK BETWEEN LINES, because the surface does. `useLiveTips`
 * calls `nextTip` once a second with an empty string as well as on every
 * sentence, and three triggers — the opening, consent, the twelve-minute mark —
 * exist only on that path. A demo that judged sentences alone would report that
 * `call_opening` never fires, on a build where it fires on every call.
 *
 * IT ASSERTS RATHER THAN PRINTS. Every check below is a way this could be
 * quietly wrong while still looking fine on screen: a tip too long for the card,
 * two tips stacked on one sentence, a trigger that never fires because its
 * phrase does not survive normalisation, and — the one that takes real work — a
 * rule that fires on the OPERATOR'S own words. One microphone hears one room, so
 * nothing at runtime can tell the two voices apart. The fixtures can:
 * `speakerHint` is in them for exactly this, and this script is the only place
 * it is ever read.
 */
import { register } from 'node:module'

register('./ts-alias-hook.mjs', import.meta.url)

const { nextTip, matchTriggers, MAX_TIP_WORDS, TIP_HOLD_MS } = await import(
  '@/lib/assistant/triggers'
)
const { TIP_SPECS, TIP_TRIGGERS } = await import('@/lib/assistant/vocabulary')
const { MockTranscriptProvider } = await import('@/lib/transcript/mock/provider')
const { SPEAKERPHONE_CALL } = await import('@/lib/transcript/fixtures/speakerphone')
const { LOGISTICS_CALL } = await import('@/lib/transcript/fixtures/logistics')
const { DATED_SITE } = await import('@/lib/assistant/fixtures/dated-site')
const { NO_WEBSITE } = await import('@/lib/assistant/fixtures/no-website')

const LIVE = process.argv.includes('--live')
const SPEED = LIVE ? 1 : 10

/** How often the surface asks the clock. `useLiveTips` rides `elapsedMs`. */
const TICK_MS = 1_000

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length

function clock(ms) {
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const dim = (text) => `\x1b[2m${text}\x1b[0m`
const bold = (text) => `\x1b[1m${text}\x1b[0m`

/** The provenance a fixture briefing has none of. Stamped by hand; nothing is generated here. */
function briefingOf(fixture) {
  return {
    origin: { provider: 'mock', model: null, generatedAt: new Date().toISOString() },
    ...fixture.briefing,
  }
}

/* ------------------------------------------------------------------------- *
 * One call
 * ------------------------------------------------------------------------- */

/**
 * Play a call and collect what the assistant said during it.
 *
 * Returns the cards and the problems, rather than printing a verdict, so the
 * two runs can be judged together at the end — a script that exited on the
 * first call's failure would hide the second call's.
 */
async function playCall({ title, note, lines: source, briefing, mustFire }) {
  /*
   * The call, sped up. The provider takes its lines as a constructor argument
   * for exactly this reason — nothing about playback speed belongs inside it.
   * Every timestamp printed and asserted is scaled back, so the numbers are the
   * call's own however fast it was watched.
   */
  const lines = source.map((line) => ({ ...line, atMs: Math.round(line.atMs / SPEED) }))

  /** What the operator said, by the timestamp the provider will emit it under. */
  const spokenBy = new Map(lines.map((line) => [line.atMs, line.speakerHint]))

  /** `ShownTip[]`, exactly as the surface keeps it — what `nextTip` dedupes against. */
  const shown = []
  /** The same tips with their words, which `ShownTip` has no room for. */
  const cards = []

  let lastShownAtMs = null
  let lastShownWeight = null

  /** How far the once-a-second tick has been run. The surface's `elapsedMs`. */
  let clockMs = 0

  /** Every speaker the provider emitted. Must only ever be one, and be `unknown`. */
  const speakers = new Set()
  let interims = 0

  console.log(`\n  ${bold(title)}`)
  console.log(`  ${dim(note)}\n`)

  /** Overwrite in place, the way the recogniser overwrites its own guess. */
  function interim(text) {
    if (!process.stdout.isTTY) return
    process.stdout.write(`\r\x1b[2K  ${dim(`…  ${text}`)}`)
  }

  function consider(text, atMs) {
    const tip = nextTip(text, {
      atMs,
      /*
       * Marked, so these runs exercise the speech rules rather than the consent
       * one, which would otherwise outrank every sentence in the call. Consent
       * gets its own check at the bottom of the file.
       */
      consentNoted: true,
      briefing,
      shown,
      lastShownAtMs,
      lastShownWeight,
    })

    if (!tip) return

    const spec = TIP_SPECS[tip.trigger]
    console.log('')
    console.log(`          ${dim(spec.label.toUpperCase())} ${dim(`· from the ${tip.source}`)}`)
    console.log(`          ${bold(tip.body)}  ${dim(`(${wordCount(tip.body)}w)`)}`)
    console.log('')

    shown.push({ trigger: tip.trigger, atMs: tip.atMs })
    cards.push(tip)
    lastShownAtMs = tip.atMs
    lastShownWeight = spec.weight
  }

  /**
   * Every whole second up to here, the way the tab would have run them.
   *
   * Run BEFORE the sentence that lands at that moment, because that is the
   * order the surface sees them in: the clock has already been at 4s many times
   * over by the time the first line is committed.
   */
  function catchUpClock(toMs) {
    while (clockMs + TICK_MS <= toMs) {
      clockMs += TICK_MS
      consider('', clockMs)
    }
  }

  const provider = new MockTranscriptProvider(lines)

  await new Promise((done) => {
    provider.start({
      onStatus: (status) => {
        if (status === 'stopped') done()
      },
      onError: (message) => console.error(`  \x1b[31m[error]\x1b[0m ${message}`),
      onChunk: (chunk) => {
        speakers.add(chunk.speaker)

        /*
         * Interim guesses are drawn and never judged. A tip fired off a
         * half-recognised sentence would be a tip about a sentence that was
         * never said — the recogniser revises "was soll das" into "was soll das
         * dann kosten" — and the surface passes only finals to the rules for the
         * same reason it stores only finals.
         */
        if (!chunk.final) {
          interims += 1
          interim(chunk.text)
          return
        }

        if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K')

        const atMs = chunk.atMs * SPEED
        catchUpClock(atMs)

        // `speakerHint` is printed here and read by the "own voice" check.
        // Nothing at runtime has it — every chunk above arrives `unknown`.
        const hint = spokenBy.get(chunk.atMs)
        const who = hint === 'operator' ? dim('you') : hint === 'both' ? dim('···') : dim(' — ')
        console.log(`  ${dim(clock(atMs))} ${who}  ${chunk.text}`)

        consider(chunk.text, atMs)
      },
    })
  })

  /* ----------------------------------------------------------------------- *
   * What has to be true about that run
   * ----------------------------------------------------------------------- */

  const problems = []
  const say = (problem) => problems.push(`${title}: ${problem}`)

  /* 1. The bound is a bound. */
  for (const tip of cards) {
    const count = wordCount(tip.body)
    if (count > MAX_TIP_WORDS) {
      say(`the ${tip.trigger} tip is ${count} words, over the ${MAX_TIP_WORDS} limit`)
    }
  }

  /*
   * 2. Nothing the operator said produced a tip.
   *
   * Only lines that are entirely his. A `both` line carries his sentence and
   * theirs in one segment and cannot be asked this question — which is a fact
   * about speakerphones, not a gap in the check. Clock rules are excluded by
   * the `phrase !== null` filter: they did not fire on words at all.
   */
  for (const line of source) {
    if (line.speakerHint !== 'operator') continue
    const spoken = matchTriggers(line.text, { atMs: line.atMs, consentNoted: true }).filter(
      (match) => match.phrase !== null,
    )
    if (spoken.length) {
      say(
        `your own line at ${clock(line.atMs)} fired ` +
          spoken.map((match) => `${match.trigger} ("${match.phrase}")`).join(', '),
      )
    }
  }

  /* 3. One tip per moment. Never two cards for one sentence. */
  const moments = new Set()
  for (const tip of cards) {
    if (moments.has(tip.atMs)) say(`two tips at ${clock(tip.atMs)}`)
    moments.add(tip.atMs)
  }

  /* 4. A trigger fires at most once in a call. */
  const triggers = cards.map((tip) => tip.trigger)
  if (new Set(triggers).size !== triggers.length) {
    say(`a trigger repeated: ${triggers.join(', ')}`)
  }

  /* 5. The moments this call was kept for are recognised. */
  for (const trigger of mustFire) {
    if (!triggers.includes(trigger)) say(`${trigger} never fired — the call contains it`)
  }

  /* 6. The recogniser behaved as the surface assumes: one room, and revisions. */
  if (speakers.size !== 1 || !speakers.has('unknown')) {
    say(`the provider emitted speakers ${[...speakers].join(', ')} — must only be "unknown"`)
  }
  if (interims === 0) {
    say('no interim guesses arrived — the "finals only" rule was never exercised')
  }

  const end = source[source.length - 1].atMs
  console.log(`  ${cards.length} tips over ${clock(end)}, ${interims} interim guesses ignored:`)
  for (const tip of cards) {
    console.log(`    ${dim(clock(tip.atMs))}  ${tip.trigger} ${dim(`(${tip.source})`)}`)
  }

  return problems
}

/* ------------------------------------------------------------------------- *
 * The run
 * ------------------------------------------------------------------------- */

console.log(
  `\n  ${dim(
    `via MockTranscriptProvider${LIVE ? '' : ' at 10× speed'} · consent marked · ` +
      `${MAX_TIP_WORDS}-word limit · clock ticked every ${TICK_MS / 1000}s`,
  )}`,
)

const problems = []

problems.push(
  ...(await playCall({
    title: 'Elektro Brenner — a dated site, written',
    note: `briefing: ${DATED_SITE.key} · walks four objections and a callback`,
    lines: SPEAKERPHONE_CALL,
    briefing: briefingOf(DATED_SITE),
    // Named in the fixture's own header comment.
    mustFire: ['no_time', 'already_have_someone', 'price_question', 'buying_signal'],
  })),
)

problems.push(
  ...(await playCall({
    title: 'Logistik Recklinghausen — no website, transcribed',
    note: `briefing: ${NO_WEBSITE.key} · a real call; produced one tip before the rules grew`,
    lines: LOGISTICS_CALL,
    briefing: briefingOf(NO_WEBSITE),
    /*
     * The six moments this call actually contains, in the order it contains
     * them. Five of them were silent under the first rule list — the opening,
     * the value doubt at 0:37, the stated need at 1:06, the phone complaint at
     * 1:57 and the offered week at 3:09 — and `send_me_an_email` at 2:32 is the
     * one that did fire, kept here so it cannot be lost while adding the rest.
     */
    mustFire: [
      'call_opening',
      'doubts_the_value',
      'named_a_need',
      'too_many_calls',
      'send_me_an_email',
      'slot_named',
    ],
  })),
)

/* ------------------------------------------------------------------------- *
 * And the things that are true of no particular call
 * ------------------------------------------------------------------------- */

/* Every standing line fits the card, including the ones neither call reached. */
for (const trigger of TIP_TRIGGERS) {
  const count = wordCount(TIP_SPECS[trigger].standing)
  if (count > MAX_TIP_WORDS) {
    problems.push(`standing line for ${trigger} is ${count} words, over the ${MAX_TIP_WORDS} limit`)
  }
}

/* Consent speaks up on its own, with nobody having said anything about it. */
const consentRun = nextTip('', {
  atMs: 60_000,
  consentNoted: false,
  briefing: briefingOf(DATED_SITE),
  shown: [],
  lastShownAtMs: null,
  lastShownWeight: null,
})
if (consentRun?.trigger !== 'consent_not_noted') {
  problems.push('an unmarked consent a minute in produced no tip')
}

/*
 * And the opening does not outstay its window. A card telling him how to open a
 * call, arriving at minute two, is the failure this window exists to prevent —
 * and it is invisible in a playthrough, because by then something else has
 * always fired.
 */
const lateOpening = nextTip('', {
  atMs: 120_000,
  consentNoted: true,
  briefing: null,
  shown: [],
  lastShownAtMs: null,
  lastShownWeight: null,
})
if (lateOpening !== null) {
  problems.push(`the clock produced ${lateOpening.trigger} at 02:00, where it should be silent`)
}

/* ------------------------------------------------------------------------- *
 * The verdict
 * ------------------------------------------------------------------------- */

console.log(dim(`\n  Each tip stays ${TIP_HOLD_MS / 1000}s; a stronger one may replace it sooner.\n`))

if (problems.length) {
  for (const problem of problems) console.error(`  \x1b[31m✗\x1b[0m ${problem}`)
  process.exit(1)
}

console.log(
  `  \x1b[32m✓\x1b[0m one tip per moment, none over ${MAX_TIP_WORDS} words, ` +
    `nothing fired by your own voice\n`,
)
