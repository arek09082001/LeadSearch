#!/usr/bin/env node
/*
 * Generate the value for LEAD_ENGINE_OWNER_PASSWORD_HASH.
 *
 *   node scripts/hash-password.mjs 'your passphrase'
 *
 * Passing the passphrase as an argument puts it in your shell history. On a
 * single-operator machine that is usually fine; if it is not, run the script
 * with no argument and it will read one line from stdin instead.
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

const KEY_LENGTH = 64

function hash(password) {
  const salt = randomBytes(16)
  const key = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH)
  // Colons and base64url: a `$`-separated hash gets mangled by dotenv expansion.
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`
}

let password = process.argv[2]

if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  password = await rl.question('Passphrase: ')
  rl.close()
}

if (!password) {
  console.error('No passphrase given.')
  process.exit(1)
}

if (password.length < 12) {
  console.error('Use at least 12 characters. This is the only thing between the internet')
  console.error('and your leads library.')
  process.exit(1)
}

console.log(`LEAD_ENGINE_OWNER_PASSWORD_HASH="${hash(password)}"`)
