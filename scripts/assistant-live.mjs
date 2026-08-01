#!/usr/bin/env node
/*
 * Put the real model through the real prompts, without running the app.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/assistant-live.mjs
 *
 * The counterpart to `assistant-demo.mjs`, and it exists for the same reason:
 * a briefing is prose, and prose has to be read by a person. That script reads
 * the fixtures; this one reads what Sonnet actually writes when it is handed
 * the same lead and the same German call the fixtures were built around.
 *
 * WHAT IT PROVES. That `ASSISTANT_PROVIDER=anthropic` produces something the
 * operator would say on a phone — the one thing no type checker can answer. It
 * runs the same system prompts, the same JSON schemas and the same validators
 * the app runs, so a briefing that comes back malformed here comes back
 * malformed there.
 *
 * WHAT IT DOES NOT DO, LOUDLY: it does not touch the ledger and it is not
 * bounded by `assistant_ceiling_usd`. Both of those live behind Supabase, which
 * this script has no credentials for and no business holding. It therefore
 * SPENDS REAL MONEY OFF THE BOOKS — a few cents, printed at the end so the
 * number is at least visible. The app is the thing that is bounded; this is a
 * diagnostic, and it says so every time it runs.
 *
 * It imports `prompts.ts`, `shapes.ts` and `pricing.ts` directly rather than the
 * provider. Those three are deliberately not `server-only` — they hold prices
 * and prose and no credential — and the provider is, because it holds a key.
 */
import { register } from 'node:module'

register('./ts-alias-hook.mjs', import.meta.url)

const Anthropic = (await import('@anthropic-ai/sdk')).default

const { BRIEFING_SYSTEM, SUMMARY_SYSTEM, briefingPrompt, summaryPrompt } = await import(
  '@/lib/assistant/anthropic/prompts'
)
const { briefingSchema, SUMMARY_SCHEMA, readBriefing, readSummary } = await import(
  '@/lib/assistant/anthropic/shapes'
)
const { ASSISTANT_MODELS, unitPriceUsd } = await import('@/lib/assistant/anthropic/pricing')
const { SPEAKERPHONE_CALL } = await import('@/lib/transcript/fixtures/speakerphone')

const key = process.env.ANTHROPIC_API_KEY
if (!key) {
  console.error(
    'ANTHROPIC_API_KEY is not set. This script makes real, billable requests;\n' +
      'there is deliberately no way to run it without saying so.',
  )
  process.exit(1)
}

const client = new Anthropic({ apiKey: key })

/* ------------------------------------------------------------------------- *
 * The lead: the hardest of the three fixture cases, and the most common.
 * A site that exists, that somebody paid for, and that nobody has touched.
 * ------------------------------------------------------------------------- */

const LEAD = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Elektro Brenner',
  city: 'Heilbronn',
  phone: '+49 7131 000000',
  website: 'https://elektro-brenner.example',
  primaryType: 'electrician',
  rating: 4.6,
  userRatingCount: 41,
  status: 'new',
  score: 81,
}

const INPUT = {
  lead: LEAD,
  findings: [
    {
      code: 'stale_copyright',
      mark: '2019',
      label: 'The footer year stopped in 2019',
      severity: 'warning',
      value: { year: 2019 },
    },
    {
      code: 'psi_poor',
      mark: 'PSI 23',
      label: 'Google scores the mobile page 23 out of 100',
      severity: 'critical',
      value: { score: 23 },
    },
    {
      code: 'not_mobile_friendly',
      mark: 'No phone layout',
      label: 'The page has no mobile layout',
      severity: 'critical',
      value: null,
    },
  ],
  measurements: {
    auditedAt: '2026-07-30T09:12:00.000Z',
    websiteStatus: 'ok',
    psiPerformance: 23,
    loadMs: 4_800,
    copyrightYear: 2019,
    platform: 'WordPress',
    platformVersion: '5.4',
  },
  history: {
    lastContactedAt: null,
    previousCalls: 0,
    lastOutcome: null,
    lastSummary: null,
    notes: [],
  },
  reviews: [
    {
      rating: 5,
      body: 'Kam am selben Tag, hat den Zählerkasten sauber gemacht. Sehr zu empfehlen.',
      relativeAge: 'vor 2 Monaten',
      publishedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      rating: 4,
      body: 'Gute Arbeit, aber telefonisch schwer zu erreichen.',
      relativeAge: 'vor 5 Monaten',
      publishedAt: '2026-03-01T00:00:00.000Z',
    },
  ],
}

/** The transcript as the app stores it: one microphone, so nobody is labelled. */
const TRANSCRIPT = SPEAKERPHONE_CALL.map((line) => ({
  atMs: line.atMs,
  speaker: 'unknown',
  text: line.text,
}))

/* ------------------------------------------------------------------------- *
 * Asking
 * ------------------------------------------------------------------------- */

const spend = []

async function ask({ job, system, prompt, schema, maxTokens }) {
  const model = ASSISTANT_MODELS[job]

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    thinking: job === 'tip' ? { type: 'disabled' } : { type: 'adaptive' },
    output_config: {
      format: { type: 'json_schema', schema },
      ...(job === 'tip' ? {} : { effort: 'medium' }),
    },
    messages: [{ role: 'user', content: prompt }],
  })

  spend.push({
    job,
    model,
    usd:
      response.usage.input_tokens * unitPriceUsd(model, 'input') +
      response.usage.output_tokens * unitPriceUsd(model, 'output'),
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
  })

  if (response.stop_reason === 'refusal') throw new Error(`${job}: the model declined.`)
  if (response.stop_reason === 'max_tokens') throw new Error(`${job}: ran out of room.`)

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

  return JSON.parse(text)
}

/* ------------------------------------------------------------------------- *
 * Printing, in the shape the operator reads
 * ------------------------------------------------------------------------- */

const RULE = '─'.repeat(78)

function heading(text) {
  console.log(`\n${RULE}\n${text}\n${RULE}`)
}

console.log('Real requests, real money, no ledger. See the note at the top of this file.')

heading(`BRIEFING — ${ASSISTANT_MODELS.briefing}`)

const briefing = readBriefing(
  await ask({
    job: 'briefing',
    system: BRIEFING_SYSTEM,
    prompt: briefingPrompt(INPUT),
    schema: briefingSchema(INPUT.findings.map((finding) => finding.code)),
    maxTokens: 4_000,
  }),
  { provider: 'anthropic', model: ASSISTANT_MODELS.briefing, generatedAt: new Date().toISOString() },
)

console.log(`\n${briefing.headline}\n`)
console.log(`OPENING\n  ${briefing.opening}\n`)
console.log('POINTS')
for (const point of briefing.points) {
  console.log(`  ${point.label}${point.code ? ` [${point.code}]` : ''}`)
  console.log(`    ${point.detail}`)
}
console.log('\nOBJECTIONS')
for (const objection of briefing.objections) {
  console.log(`  "${objection.objection}"${objection.trigger ? ` (${objection.trigger})` : ''}`)
  console.log(`    ${objection.reply}`)
}
console.log(`\nASK\n  ${briefing.ask}\n`)
console.log('DO NOT SAY')
for (const line of briefing.avoid) console.log(`  - ${line}`)

heading(`SUMMARY — ${ASSISTANT_MODELS.summary}`)

const summary = readSummary(
  await ask({
    job: 'summary',
    system: SUMMARY_SYSTEM,
    prompt: summaryPrompt(TRANSCRIPT, LEAD),
    schema: SUMMARY_SCHEMA,
    maxTokens: 2_000,
  }),
  { provider: 'anthropic', model: ASSISTANT_MODELS.summary, generatedAt: new Date().toISOString() },
)

console.log(`\n${summary.body}\n`)
console.log(`  Suggested status:      ${summary.suggestedStatus ?? '(none — the call decided nothing)'}`)
console.log(`  Suggested next action: ${summary.suggestedNextAction ?? '(none)'}`)
console.log(
  `  Callback agreed:       ${
    summary.suggestedFollowUpDays === null
      ? '(none — the ordinary answer)'
      : `${summary.suggestedFollowUpDays} days out`
  }`,
)

/* ------------------------------------------------------------------------- *
 * What it cost
 * ------------------------------------------------------------------------- */

heading('WHAT THAT COST')

let total = 0
for (const entry of spend) {
  total += entry.usd
  console.log(
    `  ${entry.job.padEnd(9)} ${entry.model.padEnd(18)} ` +
      `${String(entry.input).padStart(6)} in  ${String(entry.output).padStart(5)} out  ` +
      `$${entry.usd.toFixed(4)}`,
  )
}
console.log(`\n  One call, both generations: $${total.toFixed(4)}`)
console.log('\n  NOT written to api_usage. In the app it would be, against assistant_ceiling_usd.\n')
