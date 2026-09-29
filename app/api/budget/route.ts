import { auth } from '@/auth'
import { getBudgetState, setAssistantCeiling, setMonthlyCeiling } from '@/lib/search/cost'

/*
 * The running monthly total, and the ceilings that stop it.
 *
 * Reads are cheap and frequent — the search surface polls this after every run
 * — so it stays a plain GET. A ceiling is a PUT because setting it twice with
 * the same value must mean the same thing as setting it once.
 *
 * TWO CEILINGS, ONE FIELD EACH, AND A REQUEST MAY SET EITHER. They are named
 * separately rather than folded into one number because they bound different
 * halves of the same ledger and a press that moved both would be a press the
 * operator did not make — see `lib/assistant/anthropic/spend.ts`.
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

  const fields = (body ?? {}) as {
    monthlyCeilingUsd?: unknown
    assistantCeilingUsd?: unknown
  }

  /*
   * Which ceiling this press is about, decided by which field is present.
   * Undefined is "leave it alone" and is not the same as zero, which is a real
   * and meaningful setting — it is the default posture of both.
   */
  const which =
    fields.monthlyCeilingUsd !== undefined
      ? ({ set: setMonthlyCeiling, value: fields.monthlyCeilingUsd, what: 'ceiling' } as const)
      : fields.assistantCeilingUsd !== undefined
        ? ({
            set: setAssistantCeiling,
            value: fields.assistantCeilingUsd,
            what: 'assistant ceiling',
          } as const)
        : null

  if (!which) {
    return Response.json(
      { error: 'Say which ceiling: monthlyCeilingUsd or assistantCeilingUsd.' },
      { status: 400 },
    )
  }

  const ceiling = Number(which.value)
  if (!Number.isFinite(ceiling) || ceiling < 0 || ceiling > MAX_CEILING_USD) {
    return Response.json(
      {
        error: `The ${which.what} must be between $0 and $${MAX_CEILING_USD.toLocaleString('en-US')}.`,
      },
      { status: 400 },
    )
  }

  try {
    return Response.json(await which.set(ceiling))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not save the ceiling.' },
      { status: 500 },
    )
  }
}
