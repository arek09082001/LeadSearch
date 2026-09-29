import { errorResponse, requireSession } from '@/lib/api/guard'
import { SCORING_CONFIG } from '@/lib/scoring/config'
import { countUnscored, rescoreBook } from '@/lib/scoring/run'

/*
 * The ranking, as a surface.
 *
 * GET says which config version the book is being ranked under and how many
 * leads are still waiting for a first score. POST re-ranks the whole book
 * against the config as it stands right now.
 *
 * POST is synchronous — it does the work and answers with what moved, rather
 * than handing it to `after()` like the audit pass does. That is the point of
 * the whole design: there is no network underneath this, so re-ranking a few
 * hundred leads is three queries and some arithmetic. The operator changed a
 * weight and wants to know what it did to his list, and making him poll for
 * that would be inventing a wait that does not exist.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    await requireSession()
    return Response.json({
      configVersion: SCORING_CONFIG.version,
      unscored: await countUnscored(),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST() {
  try {
    await requireSession()

    const started = Date.now()
    const pass = await rescoreBook()

    return Response.json({
      ...pass,
      configVersion: SCORING_CONFIG.version,
      tookMs: Date.now() - started,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
