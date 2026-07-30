import { auth } from '@/auth'
import { getBudgetState, setMonthlyCeiling } from '@/lib/search/cost'

/*
 * The running monthly total, and the ceiling that stops it.
 *
 * Reads are cheap and frequent — the search surface polls this after every run
 * — so it stays a plain GET. The ceiling is a PUT because setting it twice with
 * the same value must mean the same thing as setting it once.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Above this, a typo stops being a typo and starts being a real invoice. */
const MAX_CEILING_USD = 10_000

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 })
  }

  try {
    return Response.json(await getBudgetState())
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not read the budget.' },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const ceiling = Number((body as { monthlyCeilingUsd?: unknown })?.monthlyCeilingUsd)
  if (!Number.isFinite(ceiling) || ceiling < 0 || ceiling > MAX_CEILING_USD) {
    return Response.json(
      { error: `The ceiling must be between $0 and $${MAX_CEILING_USD.toLocaleString('en-US')}.` },
      { status: 400 },
    )
  }

  try {
    return Response.json(await setMonthlyCeiling(ceiling))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not save the ceiling.' },
      { status: 500 },
    )
  }
}
