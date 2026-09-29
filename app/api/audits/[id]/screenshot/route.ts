import { errorResponse, requireSession } from '@/lib/api/guard'
import { signScreenshot } from '@/lib/enrichment/screenshot'
import { createServiceClient } from '@/lib/supabase/server'

/*
 * One audit's screenshot, behind the session.
 *
 * The bucket is private and stays private. This route is the only door: it
 * checks the session, looks up the object key the audit actually owns, signs a
 * URL that expires in a minute, and redirects to it. The operator's browser
 * never learns the key and never holds a link worth keeping.
 *
 * WHY A REDIRECT RATHER THAN THE BYTES. Streaming the image through here would
 * put a hundred kilobytes of function egress in front of every page load, on a
 * product whose cost ceiling is zero. The redirect costs a few hundred bytes and
 * lets Supabase serve the file it is already storing.
 *
 * The id in the path is the AUDIT's, not the lead's, and that is deliberate: an
 * audit is the thing that took the picture, so a link cannot outlive its subject
 * or drift onto a newer run of the same lead. A re-audit produces a new id.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Dynamic params are a promise in this version; awaiting is not optional.
type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params

    const { data, error } = await createServiceClient()
      .from('lead_audits')
      .select('screenshot_path')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new Error(error.message)

    const path = (data as { screenshot_path: string | null } | null)?.screenshot_path
    /*
     * 404 covers both "no such audit" and "that audit has no screenshot", on
     * purpose. They are the same fact to the one caller that exists — the img
     * tag on the lead page — and distinguishing them would only tell an
     * unauthenticated prober which uuids are real, which is a thing to give away
     * for no reason.
     */
    if (!path) return Response.json({ error: 'No screenshot for that audit.' }, { status: 404 })

    const signed = await signScreenshot(path)
    if (!signed) {
      return Response.json({ error: 'The screenshot could not be read.' }, { status: 502 })
    }

    /*
     * `private, no-store`. The signed URL behind this redirect is dead within
     * the minute, so a cached 302 is a broken image — and this is per-operator
     * content that has no business in a shared cache in the first place.
     */
    return new Response(null, {
      status: 302,
      headers: { Location: signed, 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
