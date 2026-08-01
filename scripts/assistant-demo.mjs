#!/usr/bin/env node
/*
 * Read what the assistant would say, without running the app.
 *
 *   node scripts/assistant-demo.mjs
 *
 * Three leads, one per conversation type, put through all three interfaces:
 * the briefing before the call, a tip during it, the summary after. It talks to
 * the mock directly rather than through `lib/assistant/index.ts`, which is
 * server-only and would refuse to load here.
 *
 * This exists because a briefing is prose, and prose has to be read by a person
 * before a screen is built to render it. If what comes out of here is not
 * something the operator would actually say on a phone, the fixtures are wrong —
 * and that is a lot cheaper to find out at a terminal than during a call.
 */
import { register } from 'node:module'

register('./ts-alias-hook.mjs', import.meta.url)

const { MOCK_ASSISTANT } = await import('@/lib/assistant/mock/provider')

/* ------------------------------------------------------------------------- *
 * Three leads, invented but shaped like the book
 * ------------------------------------------------------------------------- */

const CASES = [
  {
    what: 'A business with no website',
    input: {
      lead: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Bäckerei Hofmann',
        city: 'Heilbronn',
        phone: '+49 7131 000000',
        website: null,
        primaryType: 'bakery',
        rating: 4.7,
        userRatingCount: 63,
        status: 'new',
        score: 94,
      },
      findings: [
        {
          code: 'no_website',
          mark: 'No site',
          label: 'No website at all',
          severity: 'critical',
          value: null,
        },
      ],
      measurements: {
        auditedAt: '2026-07-30T09:12:00.000Z',
        websiteStatus: 'no_website',
        psiPerformance: null,
        loadMs: null,
        copyrightYear: null,
        platform: null,
        platformVersion: null,
      },
      history: {
        lastContactedAt: null,
        previousCalls: 0,
        lastOutcome: null,
        lastSummary: null,
        notes: [],
      },
    },
    said: 'Ehrlich gesagt kommt bei uns alles über Mundpropaganda, wir brauchen so etwas nicht.',
  },
  {
    what: 'A website nobody has touched in years',
    input: {
      lead: {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Elektro Wagner GmbH',
        city: 'Neckarsulm',
        phone: '+49 7132 000000',
        website: 'http://elektro-wagner.de',
        primaryType: 'electrician',
        rating: 4.1,
        userRatingCount: 18,
        status: 'new',
        score: 71,
      },
      findings: [
        { code: 'not_mobile_friendly', mark: 'Not mobile', label: 'Not built for phones', severity: 'critical', value: null },
        { code: 'psi_poor', mark: 'Very slow', label: 'Fails Google’s mobile performance test', severity: 'critical', value: { score: 23 } },
        { code: 'outdated_wordpress', mark: 'Old WordPress', label: 'Runs an unsupported WordPress', severity: 'warning', value: { version: '4.9' } },
        { code: 'stale_copyright', mark: 'Stale ©', label: 'Nobody has updated the site in years', severity: 'warning', value: { year: 2014 } },
      ],
      measurements: {
        auditedAt: '2026-07-31T06:40:00.000Z',
        websiteStatus: 'reachable',
        psiPerformance: 23,
        loadMs: 4100,
        copyrightYear: 2014,
        platform: 'WordPress',
        platformVersion: '4.9',
      },
      history: {
        lastContactedAt: null,
        previousCalls: 0,
        lastOutcome: null,
        lastSummary: null,
        notes: [],
      },
    },
    said: 'Das läuft doch, es hat sich noch nie jemand beschwert.',
  },
  {
    what: 'A site with no Impressum',
    input: {
      lead: {
        id: '00000000-0000-0000-0000-000000000003',
        name: 'Physiotherapie am Markt',
        city: 'Ludwigsburg',
        phone: '+49 7141 000000',
        website: 'https://physio-am-markt.de',
        primaryType: 'physiotherapist',
        rating: 4.9,
        userRatingCount: 41,
        status: 'new',
        score: 66,
      },
      findings: [
        { code: 'no_imprint', mark: 'No imprint', label: 'No Impressum', severity: 'critical', value: null },
        { code: 'no_privacy_policy', mark: 'No privacy', label: 'No privacy policy is linked', severity: 'critical', value: null },
      ],
      measurements: {
        auditedAt: '2026-07-31T07:05:00.000Z',
        websiteStatus: 'reachable',
        psiPerformance: 78,
        loadMs: 900,
        copyrightYear: 2025,
        platform: null,
        platformVersion: null,
      },
      history: {
        lastContactedAt: '2026-06-02T08:30:00.000Z',
        previousCalls: 1,
        lastOutcome: 'gatekeeper',
        // What the assistant wrote up after that call, carried in whether or
        // not the operator took it — see `BriefingHistory.lastSummary`. The
        // mock ignores it, which is the thing the run below makes visible.
        lastSummary:
          'Rang once and did not get past reception. The owner is in on Thursdays; nothing ' +
          'about the site was discussed and nothing was agreed.',
        notes: ['Reception said the owner is in on Thursdays.'],
      },
    },
    said: 'Und woher haben Sie meine Nummer? Was ist mit meinen Daten?',
  },
]

/* ------------------------------------------------------------------------- *
 * Printing
 * ------------------------------------------------------------------------- */

const rule = (label) => `\n${'─'.repeat(78)}\n${label}\n${'─'.repeat(78)}`

function printBriefing(briefing, ms) {
  console.log(`\n  ${briefing.headline}\n`)
  console.log(`  OPEN     ${briefing.opening}\n`)

  console.log('  POINTS')
  for (const point of briefing.points) {
    console.log(`    · ${point.label}${point.code ? `  [${point.code}]` : ''}`)
    console.log(`      ${point.detail}`)
  }

  console.log('\n  IF THEY SAY')
  for (const entry of briefing.objections) {
    console.log(`    · “${entry.objection}”`)
    console.log(`      → ${entry.reply}`)
  }

  console.log(`\n  ASK      ${briefing.ask}`)

  console.log('\n  DO NOT SAY')
  for (const line of briefing.avoid) console.log(`    · ${line}`)

  console.log(
    `\n  [${briefing.origin.provider}${briefing.origin.model ? `/${briefing.origin.model}` : ''}, ${ms}ms]`,
  )
}

/* ------------------------------------------------------------------------- *
 * Run
 * ------------------------------------------------------------------------- */

for (const testCase of CASES) {
  console.log(rule(testCase.what.toUpperCase()))

  /*
   * What the provider was told about earlier calls, printed before what it did
   * with it — because with the mock the answer is "nothing". `generate()` reads
   * findings, lead and measurements and never touches `history`, by the rule in
   * fixtures/types.ts that a fixture may not branch on its input. Printing the
   * two next to each other is how that stays a stated property rather than a
   * surprise: the briefing below is identical whether this block is empty or
   * full, and it is Phase 17 that changes that.
   */
  const { previousCalls, lastOutcome, lastSummary } = testCase.input.history
  console.log(`\n  GIVEN    ${previousCalls} earlier call(s), last filed as ${lastOutcome ?? '—'}`)
  console.log(`  LAST     ${lastSummary ?? '(no summary from an earlier call)'}`)

  const started = Date.now()
  const briefing = await MOCK_ASSISTANT.briefing.generate(testCase.input)
  printBriefing(briefing, Date.now() - started)

  // Two minutes in, they say the thing, and consent was marked at the start.
  const transcript = [{ atMs: 120_000, speaker: 'business', text: testCase.said }]

  const tip = await MOCK_ASSISTANT.tip.suggest({
    callId: '00000000-0000-0000-0000-0000000000ff',
    atMs: 121_000,
    lead: testCase.input.lead,
    consentNoted: true,
    briefing,
    transcript,
    alreadyShown: [],
  })

  console.log(`\n  THEY SAY “${testCase.said}”`)
  console.log(tip ? `  TIP      [${tip.trigger}] ${tip.body}` : '  TIP      (nothing worth saying)')

  const summary = await MOCK_ASSISTANT.summary.summarise(transcript, testCase.input.lead)
  console.log(`\n  AFTER    ${summary.body}`)
  console.log(`  STATUS   ${summary.suggestedStatus ?? '(no change suggested)'}`)
  console.log(`  NEXT     ${summary.suggestedNextAction ?? '(nothing)'}`)
  // Days rather than a date, and that is the thing to check here: nothing behind
  // the boundary reads a clock. The store resolves it against `calls.ended_at`.
  console.log(
    `  BACK IN  ${
      summary.suggestedFollowUpDays === null
        ? '(nothing agreed)'
        : `${summary.suggestedFollowUpDays} days`
    }`,
  )
}

/* ------------------------------------------------------------------------- *
 * The two the transcript cannot produce
 * ------------------------------------------------------------------------- */

console.log(rule('CONSENT, NEVER MARKED'))

const consentTip = await MOCK_ASSISTANT.tip.suggest({
  callId: '00000000-0000-0000-0000-0000000000ff',
  atMs: 60_000,
  lead: CASES[0].input.lead,
  consentNoted: false,
  briefing: null,
  transcript: [],
  alreadyShown: [],
})

console.log(`\n  TIP      [${consentTip?.trigger}] ${consentTip?.body}\n`)
