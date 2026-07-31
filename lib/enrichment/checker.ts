import 'server-only'

import { lookup } from 'node:dns/promises'
import { connect, type PeerCertificate, type TLSSocket } from 'node:tls'

/*
 * The website checker.
 *
 * It reports MEASUREMENTS and nothing else — what the page is, never whether
 * that is good. The distinction is the one the schema draws: columns on
 * `lead_audits` hold observations, `lead_audit_findings` holds judgements, and
 * the two do not overlap so neither has to be kept in sync with the other.
 *
 * Every judgement made from what this returns lives in `findings.ts`. Keeping
 * the split means a criterion can be argued about, changed, or re-weighted
 * without anybody having to re-read a parser.
 *
 * The order of operations is deliberate and is itself diagnostic:
 *
 *   1. Is there a URL at all?          — the strongest signal there is
 *   2. Is the "site" actually a site?  — a Facebook page is not a website
 *   3. Does the name resolve?          — a lapsed domain is not a broken server
 *   4. Does TLS verify?                — an expired certificate is worse than none
 *   5. What does the page say?         — markup, platform, age
 *
 * Each step narrows what the next one can mean. A site that fails at step 3 has
 * told us nothing about its markup, and the fields for markup stay null rather
 * than false.
 */

/**
 * Bumped whenever the parsing changes, so an old audit stays explainable.
 *
 * `measure-3` is where the Impressum check joined the pass. The bump matters
 * more than usual here: on a `measure-2` audit the imprint columns are null
 * because nobody looked, and on a `measure-3` audit they are null because
 * looking found nothing. Without the version those two read identically.
 */
export const CHECKER_VERSION = 'measure-3'

const TIMEOUT_MS = 12_000
/** The TLS handshake alone. Short: it is one round trip, not a page load. */
const TLS_TIMEOUT_MS = 6_000
/** The favicon probe. Shorter still — it is worth one info-level finding. */
const FAVICON_TIMEOUT_MS = 5_000
/** Enough for <head> and a footer on any sane page; a refusal to read 40MB. */
const MAX_BYTES = 512 * 1024

/** What the stored "website" turns out to be. Free text in the schema, closed here. */
export type PresenceKind =
  | 'site'
  | 'facebook'
  | 'instagram'
  | 'linktree'
  | 'google_business'
  | 'directory'

export interface Measurement {
  websiteStatus: 'no_website' | 'unreachable' | 'reachable' | 'error'
  websiteUrl: string | null
  finalUrl: string | null
  httpStatus: number | null
  durationMs: number
  error: string | null

  /** Did the hostname resolve. False is a lapsed domain; null is our own DNS failing. */
  dnsResolves: boolean | null
  isHttps: boolean | null
  /** Did the certificate verify. Null means https was never negotiated at all. */
  tlsValid: boolean | null
  tlsExpiresAt: string | null
  /** Why the certificate was rejected. Evidence, not a verdict. */
  tlsError: string | null

  isMobileFriendly: boolean | null
  hasTitle: boolean | null
  hasMetaDescription: boolean | null
  hasFavicon: boolean | null
  isTableLayout: boolean | null

  loadMs: number | null
  copyrightYear: number | null
  platform: string | null
  platformVersion: string | null
  presenceKind: PresenceKind | null

  raw: Record<string, unknown> | null
}

/**
 * The page as it was actually fetched, handed to whatever runs next.
 *
 * NOT a measurement, and never stored: `writeAudit` maps columns one by one and
 * this is not among them. It exists so the Impressum check can read the markup
 * the checker has already paid for rather than asking the same server for the
 * same page a second time — see `lib/enrichment/imprint.ts`.
 */
export interface FetchedPage {
  html: string
  finalUrl: string
  isHttps: boolean
  /**
   * The fetch fell back to http:// because the certificate would not verify.
   *
   * Load-bearing, not trivia. `isHttps` is false on such a site, and anything
   * downstream that reads it as "this business serves plaintext" would be
   * wrong: the site does serve TLS, badly. `invalid_certificate` is the finding
   * that belongs to it, and no other check may claim the same fault.
   */
  fetchedOverHttp: boolean
}

/** What a visit produced: the observations, and the page they were read from. */
export interface SiteVisit {
  measurement: Measurement
  /** Present only when the site answered 2xx. Null in every other outcome. */
  page: FetchedPage | null
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
    dnsResolves: null,
    isHttps: null,
    tlsValid: null,
    tlsExpiresAt: null,
    tlsError: null,
    isMobileFriendly: null,
    hasTitle: null,
    hasMetaDescription: null,
    hasFavicon: null,
    isTableLayout: null,
    loadMs: null,
    copyrightYear: null,
    platform: null,
    platformVersion: null,
    presenceKind: null,
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

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./i, '').toLowerCase()
}

/* ------------------------------------------------------------------------- *
 * Step 2 — is this a website, or somebody's Facebook page?
 * ------------------------------------------------------------------------- */

const PRESENCE_HOSTS: [PresenceKind, RegExp][] = [
  ['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i],
  ['instagram', /(^|\.)instagram\.com$/i],
  ['linktree', /(^|\.)(linktr\.ee|bio\.link|beacons\.ai|campsite\.bio|taplink\.cc|linkin\.bio)$/i],
  ['google_business', /(^|\.)(business\.site|g\.page)$|^sites\.google\.com$/i],
  [
    'directory',
    /(^|\.)(yelp\.[a-z.]+|gelbeseiten\.de|dasoertliche\.de|11880\.com|cylex\.de|wlw\.de|meinestadt\.de|golocal\.de)$/i,
  ],
]

/**
 * Classify the destination, not the link.
 *
 * Run against the FINAL url wherever one is known: a business whose domain
 * redirects to its Facebook page has, in every sense that matters to a sales
 * call, a Facebook page and not a website.
 */
function detectPresenceKind(url: URL): PresenceKind {
  const host = url.hostname.toLowerCase()
  for (const [kind, pattern] of PRESENCE_HOSTS) {
    if (pattern.test(host)) return kind
  }
  return 'site'
}

/**
 * Site builders that hand out a subdomain on their own name.
 *
 * Not the same question as the platform: a business can run Wix on its own
 * domain, which is a different (and much smaller) problem than advertising
 * `krause-fliesen.wixsite.com` on the side of a van.
 */
const FREE_SUBDOMAIN_HOSTS: [string, RegExp][] = [
  ['Wix', /\.wixsite\.com$/i],
  ['Jimdo', /\.(jimdosite\.com|jimdofree\.com|jimdo\.com)$/i],
  ['WordPress.com', /\.wordpress\.com$/i],
  ['Weebly', /\.weebly\.com$/i],
  ['Squarespace', /\.squarespace\.com$/i],
  ['Shopify', /\.myshopify\.com$/i],
  ['Webnode', /\.webnode\.[a-z.]+$/i],
  ['Blogspot', /\.blogspot\.[a-z.]+$/i],
  ['Google Sites', /^sites\.google\.com$/i],
]

export function detectFreeSubdomain(url: URL): string | null {
  for (const [vendor, pattern] of FREE_SUBDOMAIN_HOSTS) {
    if (pattern.test(url.hostname)) return vendor
  }
  return null
}

/* ------------------------------------------------------------------------- *
 * Step 3 — DNS
 * ------------------------------------------------------------------------- */

/**
 * Does the name resolve?
 *
 * Three outcomes, and the middle one is why this is asked separately at all:
 * `true` the domain is alive, `false` it is not registered or not delegated
 * (the strongest "they used to care and then stopped" signal in the audit),
 * `null` our own resolver failed and the business is not implicated.
 */
async function resolves(hostname: string): Promise<boolean | null> {
  try {
    await lookup(hostname)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'EAI_NONAME') return false
    // EAI_AGAIN and friends are a temporary failure on our side.
    return null
  }
}

/* ------------------------------------------------------------------------- *
 * Step 4 — TLS
 * ------------------------------------------------------------------------- */

/** Node's vocabulary for "the certificate is the problem". */
const CERT_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
])

interface TlsProbe {
  valid: boolean | null
  expiresAt: string | null
  error: string | null
}

function handshake(
  hostname: string,
  rejectUnauthorized: boolean,
): Promise<{ certificate: PeerCertificate | null; error: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    let socket: TLSSocket
    let settled = false

    const finish = (certificate: PeerCertificate | null, error: NodeJS.ErrnoException | null) => {
      if (settled) return
      settled = true
      socket?.destroy()
      resolve({ certificate, error })
    }

    try {
      socket = connect({
        host: hostname,
        port: 443,
        servername: hostname,
        rejectUnauthorized,
        timeout: TLS_TIMEOUT_MS,
      })
    } catch (error) {
      finish(null, error as NodeJS.ErrnoException)
      return
    }

    socket.once('secureConnect', () => finish(socket.getPeerCertificate(), null))
    socket.once('error', (error) => finish(null, error as NodeJS.ErrnoException))
    socket.once('timeout', () => {
      const timedOut: NodeJS.ErrnoException = new Error('The TLS handshake timed out.')
      timedOut.code = 'ETIMEDOUT'
      finish(null, timedOut)
    })
  })
}

/**
 * Verify the certificate, and when it fails, go back for the evidence.
 *
 * A rejected handshake tells us the certificate is bad but hands back nothing
 * to show for it, so a second connection is opened with verification off purely
 * to read the expiry date. "Their certificate expired in March 2021" is an
 * argument; "their certificate is invalid" is an assertion.
 *
 * The unverified connection is used for nothing else. Nothing is fetched over
 * it and it is closed the moment the certificate has been read.
 */
async function probeTls(hostname: string): Promise<TlsProbe> {
  const verified = await handshake(hostname, true)

  if (verified.certificate) {
    return { valid: true, expiresAt: parseCertDate(verified.certificate.valid_to), error: null }
  }

  const code = verified.error?.code ?? ''
  if (!CERT_ERROR_CODES.has(code)) {
    // Port 443 refused, timed out, or the host is unreachable. That is not a
    // statement about a certificate, so it stays unknown.
    return { valid: null, expiresAt: null, error: null }
  }

  const unverified = await handshake(hostname, false)
  return {
    valid: false,
    expiresAt: unverified.certificate ? parseCertDate(unverified.certificate.valid_to) : null,
    error: verified.error?.message?.slice(0, 300) ?? code,
  }
}

/** OpenSSL's `Mar 14 09:22:01 2021 GMT`, which Date happens to parse. */
function parseCertDate(value: string | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/* ------------------------------------------------------------------------- *
 * Step 5 — the page
 * ------------------------------------------------------------------------- */

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

function attr(tag: string, name: string): string {
  return tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))?.[1] ?? ''
}

/** A responsive viewport declaration — the cheapest honest mobile signal there is. */
function detectViewport(html: string): boolean {
  const tag = html.match(/<meta[^>]+name=["']?viewport["']?[^>]*>/i)?.[0]
  if (!tag) return false
  // A viewport pinned to a fixed pixel width is a desktop page wearing the tag.
  return /width\s*=\s*device-width/i.test(attr(tag, 'content'))
}

function detectTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
  return title ? title.slice(0, 200) : null
}

function detectMetaDescription(html: string): boolean {
  const tag = html.match(/<meta[^>]+name=["']?description["']?[^>]*>/i)?.[0]
  if (!tag) return false
  return attr(tag, 'content').trim().length > 0
}

/** A declared icon of any kind. The /favicon.ico fallback is probed separately. */
function detectDeclaredFavicon(html: string): boolean {
  const links = html.match(/<link[^>]+>/gi) ?? []
  return links.some((tag) => /rel=["']?[^"'>]*\bicon\b/i.test(tag) && attr(tag, 'href').trim())
}

/**
 * Tables used as a layout grid, rather than for tabular data.
 *
 * Heuristic, and honest about it: a table carrying presentational attributes,
 * or a table nested inside another table, is doing a job CSS has done since
 * about 2005. A lone table with a <th> is left alone — an opening-hours table
 * is not a fault.
 */
function detectTableLayout(html: string): boolean {
  const tables = html.match(/<table\b[^>]*>/gi) ?? []
  if (!tables.length) return false
  if (/<th\b/i.test(html) && tables.length === 1) return false

  const presentational = tables.some((tag) =>
    /\b(cellpadding|cellspacing|bgcolor|valign)\b|\bborder\s*=/i.test(tag),
  )
  const nested = /<table\b[\s\S]{0,8000}?<table\b/i.test(html)
  return presentational || nested
}

/**
 * Markers of a page built before responsive design existed.
 *
 * Returned as a list rather than a verdict, so the finding can name what it
 * saw. "It still uses <font> tags and a frameset" survives a sceptical business
 * owner; "your site looks dated" does not.
 */
function detectDatedMarkers(html: string, hasViewport: boolean, tableLayout: boolean): string[] {
  const markers: string[] = []
  if (tableLayout) markers.push('table-based layout')
  if (!hasViewport) markers.push('no mobile viewport')
  if (/<font\b/i.test(html)) markers.push('<font> tags')
  if (/<center\b/i.test(html)) markers.push('<center> tags')
  if (/<marquee\b/i.test(html)) markers.push('<marquee>')
  if (/<frameset\b|<frame\b/i.test(html)) markers.push('framesets')
  if (/bgcolor\s*=/i.test(html)) markers.push('bgcolor attributes')
  if (/x-shockwave-flash|\.swf\b/i.test(html)) markers.push('Flash')
  if (/<!--\[if\s+lt\s+IE/i.test(html)) markers.push('Internet Explorer conditionals')
  return markers
}

/** Detected CMS. Free text by design — the set grows with the checker. */
function detectPlatform(
  html: string,
  headers: Headers,
): { name: string | null; version: string | null } {
  const generatorTag = html.match(/<meta[^>]+name=["']?generator["']?[^>]*>/i)?.[0]
  const generator = generatorTag ? attr(generatorTag, 'content') : ''
  const haystack = `${generator} ${headers.get('x-powered-by') ?? ''} ${html.slice(0, 60_000)}`

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

  let name: string | null = null
  for (const [candidate, pattern] of signatures) {
    if (pattern.test(haystack)) {
      name = candidate
      break
    }
  }
  if (!name) name = generator.trim() ? generator.trim().slice(0, 60) : null

  return { name, version: detectVersion(name, generator, html) }
}

/**
 * The version, where the platform volunteers one.
 *
 * WordPress announces itself in the generator tag on a default install, and
 * again in the `?ver=` query on every core asset it enqueues. The second is
 * worth having, because hiding the generator tag is the first thing every
 * "security" plugin does and none of them touch the asset URLs.
 */
function detectVersion(platform: string | null, generator: string, html: string): string | null {
  const fromGenerator = generator.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null

  if (platform === 'wordpress') {
    // Core assets only. A plugin's own ?ver= says nothing about WordPress.
    const fromAssets = html.match(/wp-includes\/[^"'\s]*\?ver=(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? null
    return fromGenerator ?? fromAssets
  }

  return fromGenerator
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
  const pattern =
    /(?:©|&copy;|&#169;|copyright)[^0-9]{0,40}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi

  let latest: number | null = null
  for (const match of text.matchAll(pattern)) {
    const year = Number(match[2] ?? match[1])
    if (year < 1990 || year > thisYear + 1) continue
    if (latest === null || year > latest) latest = year
  }
  return latest
}

/** Last resort for an icon: ask for the well-known path. */
async function probeFavicon(origin: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS)
  try {
    const response = await fetch(new URL('/favicon.ico', origin), {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': userAgent() },
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/*
 * Identify honestly. A checker that pretends to be Chrome is a checker whose
 * operator cannot answer for what it did.
 *
 * Exported so the Impressum check announces itself with the same string. Two
 * user agents for one tool would mean two things to answer for.
 */
export function userAgent(): string {
  return `LeadEngineAudit/${CHECKER_VERSION} (+internal prospecting tool)`
}

/* ------------------------------------------------------------------------- *
 * The pass
 * ------------------------------------------------------------------------- */

/**
 * Visit a business's front door and write down what is there.
 *
 * Never throws. Every failure is a measurement: a site that times out is an
 * `unreachable` fact about the business, and a checker that crashed is an
 * `error` that says nothing about it. Conflating those two would let a bad
 * network make every prospect look like a prospect.
 *
 * Returns the page alongside the measurement so the next check can read it
 * without fetching it again. The page is not part of the record — nothing
 * writes it anywhere — it is the raw material the audit was made from, on loan
 * to whoever runs next.
 */
export async function measureWebsite(website: string | null): Promise<SiteVisit> {
  const result = base()
  const started = Date.now()
  let page: FetchedPage | null = null
  const done = (): SiteVisit => {
    result.durationMs = Date.now() - started
    return { measurement: result, page }
  }

  if (!website?.trim()) {
    result.websiteStatus = 'no_website'
    // The one case where a signal is genuinely false rather than unknown:
    // there is no site, so it certainly does not serve HTTPS.
    result.isHttps = false
    return done()
  }

  const url = normalizeUrl(website)
  if (!url) {
    result.websiteStatus = 'unreachable'
    result.websiteUrl = website
    result.error = 'The stored website is not a usable URL.'
    return done()
  }

  result.websiteUrl = url.toString()
  // Known from the URL alone, so it survives every failure below. A Facebook
  // page that is also down is still a Facebook page.
  result.presenceKind = detectPresenceKind(url)

  result.dnsResolves = await resolves(url.hostname)
  if (result.dnsResolves === false) {
    result.websiteStatus = 'unreachable'
    result.error = `The domain ${hostOf(url)} does not resolve.`
    result.raw = { checker: CHECKER_VERSION, dns: 'ENOTFOUND', hostname: url.hostname }
    return done()
  }

  const tls = await probeTls(url.hostname)
  result.tlsValid = tls.valid
  result.tlsExpiresAt = tls.expiresAt
  result.tlsError = tls.error

  /*
   * Where an invalid certificate sends us.
   *
   * fetch() will not complete a handshake it cannot verify, and no amount of
   * option-passing changes that. Rather than lose the whole page audit over it,
   * the fetch drops to http:// — the certificate verdict is already recorded
   * above, and the markup is still worth measuring. `raw.fetchedOverHttp` says
   * so, because the difference matters when reading the audit back.
   */
  const target = new URL(url)
  const downgraded = tls.valid === false && target.protocol === 'https:'
  if (downgraded) target.protocol = 'http:'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent(),
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de,en;q=0.8',
      },
    })

    result.httpStatus = response.status
    const landed = response.url || target.toString()
    result.finalUrl = landed
    result.isHttps = landed.startsWith('https://')

    const finalUrl = normalizeUrl(result.finalUrl)
    // Reclassify on the destination: a domain that redirects to Facebook is a
    // Facebook page, whatever was stored against the business.
    if (finalUrl) result.presenceKind = detectPresenceKind(finalUrl)

    const html = await readCapped(response)
    result.loadMs = Date.now() - started

    if (!response.ok) {
      // The server answered, so we know its scheme and its speed — but a 503
      // page tells us nothing about the real site's markup.
      result.websiteStatus = 'unreachable'
      result.error = `The site answered ${response.status}.`
      result.raw = {
        checker: CHECKER_VERSION,
        httpStatus: response.status,
        finalUrl: result.finalUrl,
        fetchedOverHttp: downgraded,
      }
      return done()
    }

    result.websiteStatus = 'reachable'

    // Only now, past every early return above: a page exists and was read. The
    // Impressum check keys off `page` being non-null and so inherits exactly
    // that condition rather than restating it.
    page = {
      html,
      finalUrl: landed,
      isHttps: landed.startsWith('https://'),
      fetchedOverHttp: downgraded,
    }

    result.isMobileFriendly = detectViewport(html)

    const title = detectTitle(html)
    result.hasTitle = title !== null
    result.hasMetaDescription = detectMetaDescription(html)
    result.isTableLayout = detectTableLayout(html)
    result.copyrightYear = detectCopyrightYear(html)

    const platform = detectPlatform(html, response.headers)
    result.platform = platform.name
    result.platformVersion = platform.version

    result.hasFavicon = detectDeclaredFavicon(html)
      ? true
      : await probeFavicon(finalUrl?.origin ?? target.origin)

    result.raw = {
      checker: CHECKER_VERSION,
      finalUrl: result.finalUrl,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      server: response.headers.get('server'),
      bytesRead: html.length,
      truncated: html.length >= MAX_BYTES,
      fetchedOverHttp: downgraded,
      title,
      datedMarkers: detectDatedMarkers(html, result.isMobileFriendly, result.isTableLayout),
      freeSubdomain: detectFreeSubdomain(finalUrl ?? target),
      tlsError: tls.error,
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    result.websiteStatus = 'unreachable'
    result.error = aborted
      ? `The site did not answer within ${TIMEOUT_MS / 1000}s.`
      : downgraded
        ? // The commonest way to end up here, and "fetch failed" would bury it:
          // the certificate is bad, so https was refused, and the plain-http
          // fallback found nothing listening either.
          `The certificate is not valid, and there is no working plain-http version to read instead.`
        : error instanceof Error
          ? error.message
          : 'The site could not be reached.'
    // A site that could not be reached over https:// has not proven anything
    // about its TLS beyond what the handshake above already established.
    result.isHttps = null
    result.raw = {
      checker: CHECKER_VERSION,
      hostname: url.hostname,
      fetchedOverHttp: downgraded,
      tlsError: tls.error,
    }
  } finally {
    clearTimeout(timer)
  }

  return done()
}
