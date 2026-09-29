import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'

/*
 * Where the picture goes, and how it comes back.
 *
 * Split out from `store.ts` for the same reason `store.ts` is split out from
 * `run.ts`: bytes in an object store and columns in a table fail differently and
 * change for different reasons. Everything in this file is best-effort by
 * design — a screenshot is corroborating evidence, and losing one must never
 * cost an audit its scores.
 *
 * THE BUCKET IS PRIVATE, and nothing here hands out a permanent link. These are
 * photographs of the websites of businesses that have not been contacted yet;
 * a public bucket would publish the operator's prospect list to anyone who
 * guessed a uuid. Reads go through a route that checks the session and then
 * signs a URL that expires in a minute.
 */

/** Created by 20260731120000_audit_screenshots.sql, private, 3 MiB ceiling. */
export const SCREENSHOT_BUCKET = 'lead-screenshots'

/**
 * How long a signed link lives.
 *
 * Long enough for the browser to follow the redirect and fetch the image,
 * short enough that a URL copied out of devtools and pasted somewhere is dead
 * before it arrives. The image is re-signed on every page load; there is
 * nothing to gain by making this generous.
 */
const SIGNED_URL_TTL_SECONDS = 60

/**
 * The formats we will accept from Lighthouse and hand to Storage.
 *
 * Lighthouse emits JPEG today. Naming the others costs nothing and means a
 * change on Google's side degrades to a working PNG rather than to a silent
 * null — but the map is still a whitelist, because the extension and the
 * Content-Type below are derived from it and neither may come from the response.
 */
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// `[\s\S]` rather than `.` with the `s` flag: the payload can legally carry
// newlines, and the dotAll flag needs a newer target than this project compiles to.
const DATA_URI = /^data:(image\/[a-z0-9+.-]+);base64,([\s\S]+)$/i

interface DecodedImage {
  bytes: Buffer
  contentType: string
  extension: string
}

/**
 * Turn `data:image/jpeg;base64,...` into bytes, or into nothing.
 *
 * Never throws. A response that is not an image we recognise is not an
 * incident — it is an audit without a screenshot, which is a state this product
 * already has to render anyway.
 */
function decode(dataUri: string): DecodedImage | null {
  const match = DATA_URI.exec(dataUri)
  if (!match) return null

  const contentType = match[1].toLowerCase()
  const extension = IMAGE_TYPES[contentType]
  if (!extension) return null

  const bytes = Buffer.from(match[2], 'base64')
  /*
   * `Buffer.from` does not throw on rubbish; it stops at the first character
   * that is not base64 and returns whatever it had. So the length check is the
   * real validation, not a sanity check: a truncated or non-base64 payload comes
   * back as a handful of bytes rather than as an error.
   */
  if (bytes.length < 512) return null

  return { bytes, contentType, extension }
}

/** One object per audit, so a path can be read back to the run that took it. */
function pathFor(auditId: string, extension: string): string {
  return `${auditId}.${extension}`
}

/**
 * Put the screenshot in the bucket and answer with its key.
 *
 * Returns null on every failure, having logged it. The caller is in the middle
 * of writing down a PageSpeed result that took Google twenty seconds to produce,
 * and throwing here would lose the scores over a picture.
 *
 * `upsert` because the only way to collide is to write the same audit twice,
 * which is a retry of the same measurement — the second frame is as true as the
 * first, and failing on the conflict would leave the row pointing at an object
 * whose upload we just refused.
 */
export async function storeScreenshot(auditId: string, dataUri: string): Promise<string | null> {
  const image = decode(dataUri)
  if (!image) {
    console.warn('[enrichment] screenshot was not a usable image', { auditId })
    return null
  }

  const path = pathFor(auditId, image.extension)
  const { error } = await createServiceClient()
    .storage.from(SCREENSHOT_BUCKET)
    .upload(path, image.bytes, { contentType: image.contentType, upsert: true })

  if (error) {
    console.error('[enrichment] could not store screenshot', { auditId, message: error.message })
    return null
  }

  return path
}

/**
 * Drop objects nobody points at any more.
 *
 * Called when a newer screenshot supersedes an older one. Failure is logged and
 * swallowed: the row has already stopped pointing here, so the worst case is an
 * orphaned object costing a few tens of kilobytes, and the alternative — failing
 * the write that already succeeded — is worse.
 */
export async function discardScreenshots(paths: string[]): Promise<void> {
  if (!paths.length) return

  const { error } = await createServiceClient().storage.from(SCREENSHOT_BUCKET).remove(paths)
  if (error) {
    console.error('[enrichment] could not discard screenshots', { paths, message: error.message })
  }
}

/**
 * A link to one screenshot, good for a minute.
 *
 * The caller has already checked the session. This function deliberately does
 * not: it takes an object key, and an object key is not a permission.
 */
export async function signScreenshot(path: string): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .storage.from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error) {
    console.error('[enrichment] could not sign screenshot', { path, message: error.message })
    return null
  }

  return data?.signedUrl ?? null
}
