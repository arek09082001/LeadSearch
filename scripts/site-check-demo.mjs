#!/usr/bin/env node
/*
 * Run the website check against real sites, without running the app.
 *
 *   node scripts/site-check-demo.mjs                       # a fixed set of shapes
 *   node scripts/site-check-demo.mjs example.de wix.com    # whatever you name
 *
 * This exists because the check decides what gets SAVED. A heuristic that is
 * slightly wrong here does not produce a slightly wrong page — it produces a
 * book full of businesses whose websites are fine, or an empty one, and either
 * way the operator finds out during a phone call. Every pattern in
 * `lib/services/site-check.ts` is a guess about markup written by somebody else,
 * and the only way to know a guess is right is to point it at the real web.
 *
 * It talks to `checkSite` directly. That module deliberately imports nothing
 * server-only — no Supabase, no environment — which is what makes this possible
 * at all, and is the reason to keep it that way.
 *
 * It makes real HTTP requests to the sites named. Nothing is written anywhere.
 */
import { register } from 'node:module'

register('./ts-alias-hook.mjs', import.meta.url)

const { checkSites, MAX_CONCURRENCY } = await import('@/lib/services/site-check')
const { FINDING_SPECS } = await import('@/lib/enrichment/vocabulary')

/*
 * One site per shape the rule cares about, chosen to be large and stable rather
 * than to be flattering. These are not customers and never will be — they are
 * the nearest public example of each thing the check has to recognise.
 */
const DEFAULTS = [
  // A modern site. The expected answer is NO signals — the boring case, and the
  // one that most needs checking: a check that finds a fault everywhere saves
  // everything, which is the same as having no rule.
  'https://www.wikipedia.org',
  // Plaintext by design, for exactly this purpose.
  'http://neverssl.com',
  // Certificates that are supposed to fail, from badssl's test suite.
  'https://expired.badssl.com',
  'https://self-signed.badssl.com',
  'https://wrong.host.badssl.com',
  // A name that does not resolve.
  'https://this-domain-should-not-exist-leadengine.example',
  // A social profile offered as a website.
  'https://www.facebook.com/Nasa',
  // Not a URL at all, which Google listings do contain.
  'not a url',
]

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS

console.log(`Checking ${targets.length} site(s), ${MAX_CONCURRENCY} at a time.\n`)

const started = Date.now()
const results = await checkSites(targets)
const elapsed = Date.now() - started

for (const [index, result] of results.entries()) {
  if (!result) {
    console.log(`${targets[index]}\n  (not reached)\n`)
    continue
  }

  const reached = result.reachable ? `${result.httpStatus}` : 'no'
  console.log(result.url)
  console.log(`  reached   ${reached}   ${result.durationMs}ms`)
  if (result.finalUrl && result.finalUrl !== result.requestedUrl) {
    console.log(`  ended at  ${result.finalUrl}`)
  }
  if (result.error) console.log(`  error     ${result.error}`)

  if (!result.signals.length) {
    console.log('  signals   none — this site would NOT be saved')
  } else {
    for (const signal of result.signals) {
      const spec = FINDING_SPECS[signal]
      console.log(`  signal    ${signal.padEnd(20)} ${spec ? spec.label : ''}`)
    }
  }
  console.log()
}

const saved = results.filter((result) => result && result.signals.length).length
console.log(
  `${saved} of ${results.length} would be saved as weak_website, in ${(elapsed / 1000).toFixed(1)}s.`,
)
