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
