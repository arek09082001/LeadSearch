#!/usr/bin/env node
/*
 * Play the mock call and watch the tips appear.
 *
 *   node scripts/tips-demo.mjs           (ten times speed, about ten seconds)
 *   node scripts/tips-demo.mjs --live    (in real time, as the call runs)
 *
 * The whole of Phase 16's acceptance criterion, at a terminal: the mock
 * conversation goes past, and at the right moments exactly one short tip
 * appears. No database, no browser, no microphone — which is possible only
 * because the trigger is a pure function, and is the best argument for having
 * made it one.
 *
 * IT GOES THROUGH THE REAL RECOGNISER, not the fixture array. The lines arrive
 * from `MockTranscriptProvider`, one at a time, interim guesses first and final
 * text after — which is what the surface actually receives, and the only way to
 * check the two things reading the fixture directly would skip: that tips fire
 * on final text and never on a half-finished guess, and that `atMs` is the
 * provider's rather than something this script made up. What is left between
 * this and the browser is React and a database, and neither decides anything.
 *
 * IT ASSERTS RATHER THAN PRINTS. Six things are checked below and every one of
 * them is a way this could be quietly wrong while still looking fine on screen:
 * a tip too long for the card, two tips stacked on one sentence, a trigger that
 * never fires because its phrase does not survive normalisation, and — the one
 * that took real work — a rule that fires on the OPERATOR'S own words. One
 * microphone hears one room, so nothing at runtime can tell the two voices
 * apart. The fixture can: `speakerHint` is in the file for exactly this, and
 * this script is the only place it is ever read.
 */
import { register } from 'node:module'

register('./ts-alias-hook.mjs', import.meta.url)

const { nextTip, matchTriggers, MAX_TIP_WORDS, TIP_HOLD_MS } = await import(
  '@/lib/assistant/triggers'
)
const { TIP_SPECS, TIP_TRIGGERS } = await import('@/lib/assistant/vocabulary')
const { MockTranscriptProvider } = await import('@/lib/transcript/mock/provider')
const { SPEAKERPHONE_CALL } = await import('@/lib/transcript/fixtures/speakerphone')
const { DATED_SITE } = await import('@/lib/assistant/fixtures/dated-site')

const LIVE = process.argv.includes('--live')
const SPEED = LIVE ? 1 : 10

/*
 * The call, sped up. The provider takes its lines as a constructor argument for
 * exactly this reason — nothing about playback speed belongs inside it. Every
 * timestamp printed and asserted below is scaled back, so the numbers are the
 * call's own however fast it was watched.
 */
const lines = SPEAKERPHONE_CALL.map((line) => ({ ...line, atMs: Math.round(line.atMs / SPEED) }))

/** What the operator said, by the timestamp the provider will emit it under. */
const spokenBy = new Map(lines.map((line) => [line.atMs, line.speakerHint]))

/*
 * The briefing this call is happening under.
 *
 * Taken from the fixture the conversation matches — a slow site with a dead
 * footer year — so the tips are drawn from the same prepared objections the
 * operator would have open in the left column. The origin is stamped by hand
 * because nothing here is generating anything.
 */
const briefing = {
  origin: { provider: 'mock', model: null, generatedAt: new Date().toISOString() },
  ...DATED_SITE.briefing,
}

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length

function clock(ms) {
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const dim = (text) => `\x1b[2m${text}\x1b[0m`
const bold = (text) => `\x1b[1m${text}\x1b[0m`

/* ------------------------------------------------------------------------- *
 * The run
 * ------------------------------------------------------------------------- */

/** `ShownTip[]`, exactly as the surface keeps it — what `nextTip` dedupes against. */
const shown = []
/** The same tips with their words, which `ShownTip` has no room for. */
const cards = []

let lastShownAtMs = null
let lastShownWeight = null

/** Every speaker the provider emitted. Must only ever be one, and be `unknown`. */
const speakers = new Set()
let interims = 0

console.log(`\n  ${bold('One call, and what the assistant says during it.')}`)
console.log(
  `  ${dim(
    `via MockTranscriptProvider${LIVE ? '' : ' at 10× speed'} · consent marked · ` +
      `briefing: ${DATED_SITE.key} · ${MAX_TIP_WORDS}-word limit`,
  )}\n`,
)

/** Overwrite in place, the way the recogniser overwrites its own guess. */
function interim(text) {
  if (!process.stdout.isTTY) return
  process.stdout.write(`\r\x1b[2K  ${dim(`…  ${text}`)}`)
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
       * half-recognised sentence would be a tip about a sentence that was never
       * said — the recogniser revises "was soll das" into "was soll das dann
       * kosten" — and the surface passes only finals to the rules for the same
       * reason it stores only finals.
       */
      if (!chunk.final) {
        interims += 1
        interim(chunk.text)
        return
      }

      if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K')

      // `speakerHint` is printed here and read by assertion 2. Nothing at
      // runtime has it — every chunk above arrives `speaker: 'unknown'`.
      const who = spokenBy.get(chunk.atMs) === 'operator' ? dim('you') : dim(' — ')
      console.log(`  ${dim(clock(chunk.atMs * SPEED))} ${who}  ${chunk.text}`)

      const tip = nextTip(chunk.text, {
        atMs: chunk.atMs * SPEED,
        // Marked, so this run exercises the speech rules rather than the
        // consent one, which would otherwise outrank every sentence in the
        // call. Assertion 6 is where consent gets its own check.
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
    },
  })
})

/* ------------------------------------------------------------------------- *
 * What has to be true about that run
 * ------------------------------------------------------------------------- */

const problems = []

/* 1. The bound is a bound — on what was shown, and on every line that could be. */
for (const tip of cards) {
  const count = wordCount(tip.body)
  if (count > MAX_TIP_WORDS) {
    problems.push(`the ${tip.trigger} tip is ${count} words, over the ${MAX_TIP_WORDS} limit`)
  }
}
for (const trigger of TIP_TRIGGERS) {
  const count = wordCount(TIP_SPECS[trigger].standing)
  if (count > MAX_TIP_WORDS) {
    problems.push(`standing line for ${trigger} is ${count} words, over the ${MAX_TIP_WORDS} limit`)
  }
}

/* 2. Nothing the operator said produced a tip. */
for (const line of SPEAKERPHONE_CALL) {
  if (line.speakerHint !== 'operator') continue
  const spoken = matchTriggers(line.text, { atMs: line.atMs, consentNoted: true }).filter(
    (match) => match.phrase !== null,
  )
  if (spoken.length) {
    problems.push(
      `your own line at ${clock(line.atMs)} fired ` +
        spoken.map((match) => `${match.trigger} ("${match.phrase}")`).join(', '),
    )
  }
}

/* 3. One tip per moment. Never two cards for one sentence. */
const moments = new Set()
for (const tip of cards) {
  if (moments.has(tip.atMs)) problems.push(`two tips at ${clock(tip.atMs)}`)
  moments.add(tip.atMs)
}

/* 4. A trigger fires at most once in a call. */
const triggers = cards.map((tip) => tip.trigger)
if (new Set(triggers).size !== triggers.length) {
  problems.push(`a trigger repeated: ${triggers.join(', ')}`)
}

/* 5. The conversation this fixture was written to walk through is recognised.
 *    The four are named in the fixture's own header comment. */
for (const trigger of ['no_time', 'already_have_someone', 'price_question', 'buying_signal']) {
  if (!triggers.includes(trigger)) problems.push(`${trigger} never fired — the fixture contains it`)
}

/* 6. Consent speaks up on its own, with nobody having said anything about it. */
const consentRun = nextTip('', {
  atMs: 60_000,
  consentNoted: false,
  briefing,
  shown: [],
  lastShownAtMs: null,
  lastShownWeight: null,
})
if (consentRun?.trigger !== 'consent_not_noted') {
  problems.push('an unmarked consent a minute in produced no tip')
}

/* 7. The recogniser behaved as the surface assumes: one room, and revisions. */
if (speakers.size !== 1 || !speakers.has('unknown')) {
  problems.push(`the provider emitted speakers ${[...speakers].join(', ')} — must only be "unknown"`)
}
if (interims === 0) {
  problems.push('no interim guesses arrived — the "finals only" rule was never exercised')
}

/* ------------------------------------------------------------------------- *
 * The verdict
 * ------------------------------------------------------------------------- */

const end = SPEAKERPHONE_CALL[SPEAKERPHONE_CALL.length - 1].atMs
console.log(`  ${cards.length} tips over ${clock(end)}, ${interims} interim guesses ignored:`)
for (const tip of cards) {
  console.log(`    ${dim(clock(tip.atMs))}  ${tip.trigger} ${dim(`(${tip.source})`)}`)
}
console.log(dim(`\n  Each stays ${TIP_HOLD_MS / 1000}s; a stronger one may replace it sooner.\n`))

if (problems.length) {
  for (const problem of problems) console.error(`  \x1b[31m✗\x1b[0m ${problem}`)
  process.exit(1)
}

console.log(
  `  \x1b[32m✓\x1b[0m one tip per moment, none over ${MAX_TIP_WORDS} words, ` +
    `nothing fired by your own voice\n`,
)
