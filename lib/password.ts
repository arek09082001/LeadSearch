import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/*
 * Password verification for exactly one account.
 *
 * scrypt from Node's own crypto — no dependency to audit, no supply chain. The
 * owner's hash lives in an environment variable because there is no second user
 * to store, and a users table for a single row is a schema nobody asked for.
 *
 * Format: scrypt:<salt-b64url>:<key-b64url>
 *
 * Colons and base64url, deliberately. The conventional `$`-separated PHC-style
 * string cannot survive a .env file: dotenv expands `$NAME`, so a hash written
 * that way silently arrives in process.env with pieces missing, and the only
 * symptom is a correct passphrase being rejected.
 */

const KEY_LENGTH = 64
const SCHEME = 'scrypt'

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH)
  return `${SCHEME}:${salt.toString('base64url')}:${key.toString('base64url')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split(':')
  if (scheme !== SCHEME || !saltB64 || !keyB64) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltB64, 'base64url')
    expected = Buffer.from(keyB64, 'base64url')
  } catch {
    return false
  }
  if (expected.length === 0) return false

  const actual = scryptSync(password.normalize('NFKC'), salt, expected.length)
  return timingSafeEqual(expected, actual)
}
