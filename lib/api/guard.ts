import 'server-only'

import { auth } from '@/auth'

/*
 * The session check every route handler owes before it touches data.
 *
 * proxy.ts already turns away unauthenticated traffic, so this is the second
 * lock rather than the first. It exists because a matcher is a configuration
 * file and configuration files get edited: if /api/leads ever falls out of the
 * matcher, the failure should be a 401, not an open database.
 */

export class Unauthorized extends Error {
  constructor() {
    super('Not signed in.')
    this.name = 'Unauthorized'
  }
}

export async function requireSession(): Promise<{ email: string }> {
  const session = await auth()
  if (!session?.user?.email) throw new Unauthorized()
  return { email: session.user.email }
}

/** Who asked. The refresh pass behaves differently for a schedule than for a click. */
export type Caller = 'operator' | 'schedule'

/**
 * Constant-time-ish string comparison.
 *
 * The shared secret below is compared on every scheduled invocation, and `===`
 * on strings returns as soon as it finds a difference. That is a timing oracle;
 * a slow one over the internet, but it costs nothing to close.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

/**
 * A signed-in operator, or the scheduler.
 *
 * The refresh route is the one endpoint that has to be reachable with no
 * session: it runs nightly from a cron trigger, which has no browser and no
 * cookie. The bearer secret is that trigger's only credential, so a missing
 * `CRON_SECRET` refuses the schedule outright rather than falling open — an
 * unset variable must never become an unauthenticated route that spends money
 * against the Google API.
 */
export async function requireOperatorOrSchedule(request: Request): Promise<Caller> {
  const header = request.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) {
    requireSchedule(request)
    return 'schedule'
  }

  await requireSession()
  return 'operator'
}

/**
 * The scheduler alone. Throws for everything else, including the operator.
 *
 * Fails closed on a missing `CRON_SECRET` rather than open. This is the one
 * credential standing in front of a route that spends money, and an unset
 * environment variable is the ordinary way a deployment ends up without it.
 */
export function requireSchedule(request: Request): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    throw new Unauthorized()
  }

  const header = request.headers.get('authorization') ?? ''
  const offered = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!offered || !secretsMatch(offered, secret)) throw new Unauthorized()
}

/**
 * Turn whatever a handler threw into a response.
 *
 * The operator is also the developer, so a real message is more use to him than
 * a sanitised one — the same reason ErrorState prints the raw detail. There is
 * no second audience here to leak to.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof Unauthorized) {
    return Response.json({ error: error.message }, { status: 401 })
  }
  const message = error instanceof Error ? error.message : 'The request failed.'
  console.error('[api]', error)
  return Response.json({ error: message }, { status: 500 })
}

/** Parse a JSON body, or say plainly that it was not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new Error('Malformed request body.')
  }
}
