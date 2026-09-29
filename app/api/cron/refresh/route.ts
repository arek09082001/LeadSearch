import { errorResponse, requireSchedule } from '@/lib/api/guard'
import { runScoring } from '@/lib/scoring/run'
import { countRefreshDue, runRefresh } from '@/lib/refresh/run'

/*
 * The scheduler's door, and only the scheduler's.
 *
 * It exists as a separate route for one reason: a cron trigger issues a GET, and
 * `/api/refresh` keeps the rule that a GET is a read. Rather than bend that rule
 * — a read that quietly spends money against the Google API is exactly the kind
 * of thing nobody finds until the invoice — the schedule gets its own path where
 * GET means "run", which is what a schedule always means.
 *
 * There is no session here and there cannot be, so the bearer secret is the only
 * credential. `requireSchedule` refuses outright when `CRON_SECRET` is unset: an
 * unconfigured deployment must fail closed, not turn into an open endpoint that
 * anyone can use to burn the month's Places allowance.
 *
 * Everything else about the pass — its budget guard, its deadline, its claim
 * handling — is in lib/refresh/run.ts. This route only decides who may knock.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    requireSchedule(request)

    const pass = await runRefresh({ source: 'scheduled' })
    // Free and pure: anything the pass re-audited will settle later, but leads
    // that settled since the last run are ready to rank now.
    await runScoring()

    if (pass.stoppedBy) {
      // Loud in the log, because a ceiling that stopped the nightly refresh is
      // something the operator has to act on and nobody is watching this run.
      console.warn('[refresh] the nightly pass stopped early', pass.stoppedBy)
    }

    return Response.json({ ...pass, due: await countRefreshDue() })
  } catch (error) {
    return errorResponse(error)
  }
}
