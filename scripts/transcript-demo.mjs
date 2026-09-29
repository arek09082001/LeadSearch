#!/usr/bin/env node
/*
 * Watch the mock recogniser play a call, without running the app.
 *
 *   node scripts/transcript-demo.mjs
 *
 * The fixture conversation, in real time, printed as it arrives — interim
 * guesses overwriting themselves on one line, final lines committing above.
 * It talks to `MockTranscriptProvider` directly, which is possible precisely
 * because the transcript boundary does no I/O and is not `server-only`.
 *
 * WHAT IT IS FOR. Two things that are otherwise only checkable during a phone
 * call. First: the fixture is the operator's own language, and text that reads
 * like a screenplay would make the middle column look calmer than a real
 * recogniser ever will — that is a judgement a person has to make by reading it
 * go past. Second: the interim-then-final rhythm is the part of the surface most
 * likely to flicker, and here it can be watched at a terminal in ninety seconds
 * instead of by talking to a microphone and hoping.
 *
 * It proves the provider, not the plumbing. The routes and the rows need a
 * database and a signed-in browser; this needs neither.
 *
 * Pass --fast to run it at ten times speed when you only want to see the shape.
 */
import { register } from 'node:module'

register('./ts-alias-hook.mjs', import.meta.url)

const { MockTranscriptProvider } = await import('@/lib/transcript/mock/provider')
const { SPEAKERPHONE_CALL } = await import('@/lib/transcript/fixtures/speakerphone')

const FAST = process.argv.includes('--fast')
const SPEED = FAST ? 10 : 1

/*
 * The fixture, with every timestamp divided by the speed-up. The provider takes
 * its lines as a constructor argument for exactly this reason — nothing about
 * playback speed belongs inside it.
 */
const lines = SPEAKERPHONE_CALL.map((line) => ({ ...line, atMs: Math.round(line.atMs / SPEED) }))

function clock(ms) {
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Overwrite the current line, the way the recogniser overwrites its guess. */
function interim(text) {
  if (!process.stdout.isTTY) return
  process.stdout.write(`\r\x1b[2K  \x1b[2m…  ${text}\x1b[0m`)
}

function commit(atMs, text) {
  if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K')
  console.log(`  \x1b[2m${clock(atMs * SPEED)}\x1b[0m  ${text}`)
}

console.log(
  `\nOne call, ${FAST ? 'at 10× speed' : 'in real time'}. ` +
    `${lines.length} lines over ${clock(SPEECH_END(lines) * SPEED)}.\n`,
)
console.log('  Every line arrives speaker="unknown": one microphone, one room.\n')

function SPEECH_END(all) {
  return all.length ? all[all.length - 1].atMs : 0
}

let finals = 0
let interims = 0
const speakers = new Set()

const provider = new MockTranscriptProvider(lines)

await new Promise((done) => {
  provider.start({
    onStatus(status) {
      if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K')
      console.log(`  \x1b[36m[${status}]\x1b[0m`)
      if (status === 'stopped') done()
    },
    onError(message) {
      console.error(`  \x1b[31m[error]\x1b[0m ${message}`)
    },
    onChunk(chunk) {
      speakers.add(chunk.speaker)
      if (chunk.final) {
        finals += 1
        commit(chunk.atMs, chunk.text)
      } else {
        interims += 1
        interim(chunk.text)
      }
    },
  })
})

/*
 * The three things worth asserting about a run, checked rather than eyeballed.
 * A demo that only prints is a demo that can rot silently.
 */
const problems = []
if (finals !== lines.length) problems.push(`${finals} final lines, expected ${lines.length}`)
if (interims === 0) problems.push('no interim results — the surface would never be exercised')
if (speakers.size !== 1 || !speakers.has('unknown')) {
  problems.push(`emitted speakers ${[...speakers].join(', ')} — must only ever be "unknown"`)
}

console.log(`\n  ${finals} final, ${interims} interim, speakers: ${[...speakers].join(', ')}`)

if (problems.length) {
  for (const problem of problems) console.error(`  \x1b[31m✗\x1b[0m ${problem}`)
  process.exit(1)
}

console.log('  \x1b[32m✓\x1b[0m every line final, interim path exercised, no speaker invented\n')
