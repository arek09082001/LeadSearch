import 'server-only'

/*
 * The website checker.
 *
 * It reports MEASUREMENTS and nothing else — what the page is, never whether
 * that is good. The distinction is the one the schema already draws: columns on
 * `lead_audits` hold observations, `lead_audit_findings` holds judgements, and
 * the two do not overlap so neither has to be kept in sync with the other.
 *
 * This module deliberately writes no findings and computes no score. PRODUCT.md
 * lists the audit criteria, their weighting and the score scale as undecided,
 * and inventing them here would bury a product decision in a parser. What it
 * produces is the raw material those decisions will be made from: the six
 * signals the schema already committed to, plus whether the door opened at all.
 */

/** Bumped whenever the parsing changes, so an old audit stays explainable. */
export const CHECKER_VERSION = 'measure-1'

const TIMEOUT_MS = 12_000
/** Enough for <head> and a footer on any sane page; a refusal to read 40MB. */
const MAX_BYTES = 512 * 1024

export interface Measurement {
  websiteStatus: 'no_website' | 'unreachable' | 'reachable' | 'error'
  websiteUrl: string | null
  finalUrl: string | null
  httpStatus: number | null
  durationMs: number
  error: string | null

  isHttps: boolean | null
  isMobileFriendly: boolean | null
  hasMetaDescription: boolean | null
  loadMs: number | null
  copyrightYear: number | null
  platform: string | null

  raw: Record<string, unknown> | null
}

function base(): Measurement {
  return {
    websiteStatus: 'error',
    websiteUrl: null,
    finalUrl: null,
    httpStatus: null,
    durationMs: 0,
    error: null,
    // Null, not false, throughout: a site that did not answer has not told us
    // it lacks HTTPS. "Unknown" and "absent" are different filters.
    isHttps: null,
    isMobileFriendly: null,
    hasMetaDescription: null,
    loadMs: null,
    copyrightYear: null,
    platform: null,
    raw: null,
  }
}

/** Google hands back bare hostnames often enough to be worth tolerating. */
function normalizeUrl(website: string): URL | null {
  const trimmed = website.trim()
  if (!trimmed) return null
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
}

/**
 * Read at most MAX_BYTES of the body, then stop.
 *
 * `response.text()` would buy the whole page, and some of these sites ship
 * megabytes of inlined imagery. Everything measured below is in the first few
 * KB or in the footer, and a truncated footer costs one null.
 */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const chunks: string[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      chunks.push(decoder.decode(value, { stream: true }))
      if (total >= MAX_BYTES) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return chunks.join('')
}

/** A responsive viewport declaration — the cheapest honest mobile signal there is. */
function detectViewport(html: string): boolean {
  const tag = html.match(/<meta[^>]+name=["']?viewport["']?[^>]*>/i)?.[0]
  if (!tag) return false
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
  // A viewport pinned to a fixed pixel width is a desktop page wearing the tag.
  return /width\s*=\s*device-width/i.test(content)
}

function detectMetaDescription(html: string): boolean {
  const tag = html.match(/<meta[^>]+name=["']?description["']?[^>]*>/i)?.[0]
  if (!tag) return false
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
  return content.trim().length > 0
}

/**
 * The footer year — the abandonment tell.
 *
 * Only years attached to a copyright marker count. Grepping for any 20xx would
 * match a phone number, a price, or a news date and turn the strongest signal
 * in the audit into noise. A range ("2019–2024") reports its later end, which
 * is the year the site last claimed to be maintained.
 */
function detectCopyrightYear(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, ' ')
  const thisYear = new Date().getFullYear()
  const pattern = /(?:©|&copy;|&#169;|copyright)[^0-9]{0,40}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi

  let latest: number | null = null
  for (const match of text.matchAll(pattern)) {
    const year = Number(match[2] ?? match[1])
    if (year < 1990 || year > thisYear + 1) continue
    if (latest === null || year > latest) latest = year
  }
  return latest
}

/** Detected CMS. Free text by design — the set grows with the checker. */
function detectPlatform(html: string, headers: Headers): string | null {
  const generator = html.match(/<meta[^>]+name=["']?generator["']?[^>]*content=["']([^"']*)["']/i)?.[1]
  const haystack = `${generator ?? ''} ${headers.get('x-powered-by') ?? ''} ${html.slice(0, 60_000)}`

  const signatures: [string, RegExp][] = [
    ['wordpress', /wp-content|wp-includes|wordpress/i],
    ['wix', /wix\.com|_wixCssImports|static\.parastorage/i],
    ['squarespace', /squarespace/i],
    ['shopify', /cdn\.shopify\.com|shopify/i],
    ['jimdo', /jimdo/i],
    ['webflow', /webflow/i],
    ['typo3', /typo3/i],
    ['joomla', /joomla/i],
    ['drupal', /drupal/i],
    ['ionos', /ionos|1and1|mysite-editor/i],
    ['google-sites', /sites\.google\.com/i],
  ]

  for (const [name, pattern] of signatures) {
    if (pattern.test(haystack)) return name
  }
  return generator?.trim() ? generator.trim().slice(0, 60) : null
}

/**
 * Visit a business's front door and write down what is there.
 *
 * Never throws. Every failure is a measurement: a site that times out is an
 * `unreachable` fact about the business, and a checker that crashed is an
 * `error` that says nothing about it. Conflating those two would let a bad
 * network make every prospect look like a prospect.
 */
export async function measureWebsite(website: string | null): Promise<Measurement> {
  const result = base()
  const started = Date.now()

  if (!website?.trim()) {
    result.websiteStatus = 'no_website'
    result.durationMs = Date.now() - started
    // The one case where a signal is genuinely false rather than unknown:
    // there is no site, so it certainly does not serve HTTPS.
    result.isHttps = false
    return result
  }

  const url = normalizeUrl(website)
  if (!url) {
    result.websiteStatus = 'unreachable'
    result.websiteUrl = website
    result.error = 'The stored website is not a usable URL.'
    result.durationMs = Date.now() - started
    return result
  }

  result.websiteUrl = url.toString()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Identify honestly. A checker that pretends to be Chrome is a checker
        // whose operator cannot answer for what it did.
        'User-Agent': `LeadEngineAudit/${CHECKER_VERSION} (+internal prospecting tool)`,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de,en;q=0.8',
      },
    })

    result.httpStatus = response.status
    result.finalUrl = response.url || url.toString()
    result.isHttps = result.finalUrl.startsWith('https://')

    const html = await readCapped(response)
    result.loadMs = Date.now() - started

    if (!response.ok) {
      // The server answered, so we know its scheme and its speed — but a 503
      // page tells us nothing about the real site's markup.
      result.websiteStatus = 'unreachable'
      result.error = `The site answered ${response.status}.`
      result.durationMs = Date.now() - started
      result.raw = { httpStatus: response.status, finalUrl: result.finalUrl }
      return result
    }

    result.websiteStatus = 'reachable'
    result.isMobileFriendly = detectViewport(html)
    result.hasMetaDescription = detectMetaDescription(html)
    result.copyrightYear = detectCopyrightYear(html)
    result.platform = detectPlatform(html, response.headers)
    result.raw = {
      checker: CHECKER_VERSION,
      finalUrl: result.finalUrl,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      bytesRead: html.length,
      truncated: html.length >= MAX_BYTES,
      title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? null,
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    result.websiteStatus = 'unreachable'
    result.error = aborted
      ? `The site did not answer within ${TIMEOUT_MS / 1000}s.`
      : error instanceof Error
        ? error.message
        : 'The site could not be reached.'
    // A site that could not be reached over https:// has not proven anything
    // about its TLS, so this stays unknown rather than false.
    result.isHttps = null
  } finally {
    clearTimeout(timer)
  }

  result.durationMs = Date.now() - started
  return result
}
