import 'server-only'

import { userAgent, type FetchedPage, type Measurement } from '@/lib/enrichment/checker'

/*
 * The Impressum check.
 *
 * Everything the checker measures answers "does this website work". This
 * answers "what does it say about itself" — which in Germany is a shorter
 * conversation, because §5 TMG is not a matter of taste. A business owner will
 * argue about whether his site is slow. He will not argue about whether it has
 * an Impressum; he either put one there or he did not.
 *
 * MEASUREMENTS ONLY, like the checker. Whether a missing Impressum is a problem
 * is decided in `findings.ts`, and the split is what lets that judgement be
 * argued with later without anybody re-reading a parser.
 *
 * Three things shaped this file:
 *
 *   1. THE PAGE IS ALREADY PAID FOR. The checker fetched the homepage and hands
 *      it over (`FetchedPage`). Four of the nine observations here — fonts,
 *      maps, the privacy link, the form — live in that markup, and re-fetching
 *      the same URL from the same server to read it twice would be rude and
 *      pointless. So this stage costs one request per lead, sometimes none.
 *
 *   2. A FAILED LOOKUP IS NOT A VERDICT. `state` carries that distinction and
 *      nothing else does. 'absent' means we looked, exhaustively, and there is
 *      none — the only state that may become `no_imprint`. 'error' means the
 *      lookup broke, and a broken lookup says nothing whatsoever about the
 *      business. This is the same line `lead_audits.error` and
 *      `leads.enrichment_error` already draw between them.
 *
 *   3. WHAT IS READ IS NOT WHAT IS KEPT. An Impressum names a natural person by
 *      law, and we read past that name without recording it. The postal address
 *      is kept as a boolean, never as text. The one contact detail worth
 *      storing is a company email — Google practically never supplies one, and
 *      without it there is no written outreach at all.
 *
 * Parsed with hand-written regexes over a capped string, because that is what
 * `checker.ts` does and there is no HTML library in this project. Every
 * character class here is written out in full: `\w` is ASCII-only without the
 * `u` flag, and a German address regex that cannot match ä, ö, ü or ß is a
 * regex that finds nothing.
 */

/** One page. Shorter than the homepage's 12s — an Impressum is text. */
const TIMEOUT_MS = 8_000
/** The whole stage, shared across every attempt. What bounds the worst case. */
const BUDGET_MS = 10_000
/** Half the homepage cap. Legal prose does not run to a quarter of a megabyte. */
const MAX_BYTES = 256 * 1024
/**
 * A pause before knocking a second time on the same door.
 *
 * The only sleep in this codebase, and it is not a throughput knob — the pass
 * expresses rate limiting as concurrency, and four lanes already means one
 * request per host at a time. This is the gap between the checker's request and
 * ours to that same server, moments apart. These are small business websites on
 * shared hosting, not an API with a quota.
 */
const COURTESY_MS = 500

/** Fewer anchors than this and the page is assembled in the browser. */
const MIN_ANCHORS = 3

/* ------------------------------------------------------------------------- *
 * What comes out
 * ------------------------------------------------------------------------- */

/**
 * 'found'  — an imprint page was fetched and read.
 * 'absent' — we looked, exhaustively, and there is none. The only state that
 *            may become `no_imprint`.
 * 'error'  — the lookup itself broke. Says nothing about the business.
 *
 * There is deliberately no 'skipped'. When nobody looked at all — not a real
 * site, or no room left before the pass's deadline — the measurement is `null`
 * rather than a fourth state, so there is exactly one way to say it and the
 * judges cannot disagree about which one means "no check was run".
 */
export type ImprintState = 'found' | 'absent' | 'error'

type AttemptOutcome = 'imprint' | 'not-imprint' | 'soft-404' | 'http-error' | 'failed'

export interface ImprintMeasurement {
  /** Governs the imprint half only. The page observations stand regardless. */
  state: ImprintState
  /** Why, when the lookup broke or was skipped. About the run, never the business. */
  error: string | null

  /* ---- read off the imprint page. Null unless state is 'found'. ----------
   * Null and not false on 'absent': a page that does not exist cannot be said
   * to omit a phone number. Same rule the checker holds itself to.
   */
  imprintUrl: string | null
  hasAddress: boolean | null
  hasPhone: boolean | null
  hasEmail: boolean | null
  hasVatId: boolean | null

  /* ---- contact details lifted off it, for `leads`. ---------------------- */
  email: string | null
  phone: string | null

  /* ---- read off every page we DID read: the homepage always, and the
   * imprint page too when there was one. ---------------------------------- */
  hasPrivacyPolicy: boolean | null
  loadsExternalFonts: boolean | null
  hasExternalMaps: boolean | null
  contactFormInsecure: boolean | null

  /* ---- evidence. Goes to `raw`, not to columns. ------------------------- */
  /** A consent tool was detected, which withholds the maps judgement. */
  consentManager: string | null
  /** Every URL tried and what came back. Turns 'absent' into an argument. */
  attempts: { url: string; status: number | null; outcome: AttemptOutcome }[]
  /** False when the homepage is a client-rendered shell with nothing to read. */
  linksReadable: boolean
  durationMs: number
}

/**
 * Is this lead worth an Impressum lookup?
 *
 * The same gate PageSpeed uses, and for the same reason. A business whose
 * "website" is a Facebook page has already been diagnosed — `social_only` — and
 * asking facebook.com for that business's Impressum would produce a second
 * finding for the same fault, resting on a claim that is simply not true of the
 * page we would have read.
 */
export function shouldReadImprint(measurement: Measurement): boolean {
  return measurement.websiteStatus === 'reachable' && measurement.presenceKind === 'site'
}

function blank(state: ImprintState, error: string | null): ImprintMeasurement {
  return {
    state,
    error,
    imprintUrl: null,
    hasAddress: null,
    hasPhone: null,
    hasEmail: null,
    hasVatId: null,
    email: null,
    phone: null,
    hasPrivacyPolicy: null,
    loadsExternalFonts: null,
    hasExternalMaps: null,
    contactFormInsecure: null,
    consentManager: null,
    attempts: [],
    linksReadable: true,
    durationMs: 0,
  }
}

/* ------------------------------------------------------------------------- *
 * Turning markup into something readable
 * ------------------------------------------------------------------------- */

const ENTITIES: Record<string, string> = {
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  szlig: 'ß', sect: '§', nbsp: ' ', commat: '@', quot: '"', apos: "'",
  lt: '<', gt: '>', amp: '&',
}

function codePoint(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ' '
  try {
    return String.fromCodePoint(code)
  } catch {
    return ' '
  }
}

/**
 * Put the umlauts back.
 *
 * Not a nicety. A German legal notice written by hand — which is most of the
 * ones worth finding — spells its street `Beispielstra&szlig;e`, and every
 * address pattern below looks for `straße` or `strasse`. Without this the check
 * reports "no address stated" for a page that states one perfectly clearly, and
 * it does so most reliably on exactly the old, neglected sites this product
 * exists to find.
 *
 * One pass, and `&amp;` is decoded in the same pass as everything else rather
 * than before it — so `&amp;auml;` comes out as the literal `&auml;` it was
 * written as, instead of being decoded twice into an ä nobody wrote.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => ENTITIES[name] ?? whole)
}

/**
 * The text of a page, with the code taken out first.
 *
 * Dropping `<script>` and `<style>` BEFORE stripping tags is the single most
 * load-bearing line in this file. Without it the email detector reads CSS
 * at-rules, JSON-LD blobs and analytics keys, and a site with an inline
 * stylesheet gets credited with an email address it does not publish.
 */
function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * One attribute off one tag.
 *
 * Anchored on a word start, unlike the checker's own helper, because here the
 * difference between `src` and `data-src` decides a finding: a consent-gated
 * Google Maps frame carries the URL in `data-src` and an empty `src`, and a
 * pattern that matched both would report every consent-compliant site as
 * loading maps unasked.
 */
function attribute(tag: string, name: string): string {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? ''
}

interface Anchor {
  href: string
  text: string
}

function anchors(html: string): Anchor[] {
  const found: Anchor[] = []
  const pattern = /<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi
  for (const match of html.matchAll(pattern)) {
    const href = attribute(match[1], 'href').trim()
    if (!href) continue
    // Decoded for the same reason the page text is: footers say
    // `Datenschutzerkl&auml;rung`, and a pattern matching on ä would miss it.
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' '))
    found.push({ href, text: text.replace(/\s+/g, ' ').trim() })
  }
  return found
}

/** Hostnames of one website, `www.` aside. An approximation, and enough for .de. */
function sameSite(a: string, b: string): boolean {
  const x = a.replace(/^www\./i, '').toLowerCase()
  const y = b.replace(/^www\./i, '').toLowerCase()
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------------- *
 * Finding the page
 * ------------------------------------------------------------------------- */

const IMPRINT_HREF =
  /(^|[/?#._-])(impressum|imprint|legal-?notice|anbieterkennzeichnung)(\b|[/?#._-]|$)/i
const IMPRINT_TEXT = /(impressum|anbieterkennzeichnung|legal notice|\bimprint\b)/i

/** Weaker signals, tried only after the explicit ones. A contact page often carries it. */
const WEAK_HREF = /(^|[/?#._-])(legal|kontakt|contact)(\b|[/?#._-]|$)/i

/** The page says what it is. */
const IMPRINT_MARKER =
  /(impressum|anbieterkennzeichnung|angaben gem[äa][ßs]\s*§?\s*5|vertreten durch|verantwortlich f[üu]r den inhalt)/i
/** The page says it is not there. A 200 that means 404. */
const NOT_FOUND =
  /(seite (wurde )?nicht gefunden|nichts gefunden|fehler 404|\b404\b|page not found|not be found|does not exist)/i

interface Candidate {
  url: string
  /** A link into the homepage itself. Nothing to fetch — we already have it. */
  onPage: boolean
}

/**
 * Where the Impressum might be, best guess first.
 *
 * Ordered by how much each signal proves. A link whose href or text says
 * "Impressum" is nearly certain; `/kontakt` is a guess worth making only after
 * the certain ones are exhausted, and it must never outrank one.
 */
function candidates(page: FetchedPage, links: Anchor[]): Candidate[] {
  const home = new URL(page.finalUrl)
  const strong: Candidate[] = []
  const weak: Candidate[] = []
  const seen = new Set<string>()

  for (const link of links) {
    if (/^(javascript:|mailto:|tel:)/i.test(link.href)) continue

    const strongHit = IMPRINT_HREF.test(link.href) || IMPRINT_TEXT.test(link.text)
    const weakHit = WEAK_HREF.test(link.href)
    if (!strongHit && !weakHit) continue

    /*
     * A fragment into this very page.
     *
     * German one-pagers routinely carry the Impressum as a section of the
     * homepage rather than a page of its own, and it is a real Impressum. It
     * costs no fetch and it removes a whole class of sites that would otherwise
     * be accused of having none.
     */
    if (link.href.startsWith('#')) {
      if (strongHit) return [{ url: `${page.finalUrl}${link.href}`, onPage: true }]
      continue
    }

    let resolved: URL
    try {
      resolved = new URL(link.href, page.finalUrl)
    } catch {
      continue
    }
    if (!/^https?:$/.test(resolved.protocol)) continue
    // A link to the site builder's own imprint, or to a franchise head office,
    // is not this business's imprint and must not be read as one.
    if (!sameSite(resolved.hostname, home.hostname)) continue

    const url = resolved.toString()
    if (seen.has(url)) continue
    seen.add(url)
    // Same page, different spelling: the fragment case above, arrived at the
    // long way round.
    if (url.replace(/#.*$/, '') === page.finalUrl.replace(/#.*$/, '') && resolved.hash) {
      if (strongHit) return [{ url, onPage: true }]
      continue
    }
    ;(strongHit ? strong : weak).push({ url, onPage: false })
  }

  const probes: Candidate[] = ['/impressum', '/impressum.html'].map((path) => ({
    url: new URL(path, home.origin).toString(),
    onPage: false,
  }))

  const ordered = [...strong, ...probes, ...weak]
  return ordered.filter((entry, index) => ordered.findIndex((c) => c.url === entry.url) === index)
}

/**
 * Did an off-site link claim to be the Impressum?
 *
 * If it did and nothing else worked, the answer is 'error' rather than
 * 'absent'. "It is on our head office's site" may or may not satisfy §5 TMG,
 * but it is a ten-second rebuttal to a critical finding read aloud on a call,
 * and a finding that loses that argument costs more than it was worth.
 */
function hasOffsiteImprintLink(page: FetchedPage, links: Anchor[]): boolean {
  const home = new URL(page.finalUrl)
  return links.some((link) => {
    if (!IMPRINT_HREF.test(link.href) && !IMPRINT_TEXT.test(link.text)) return false
    try {
      const resolved = new URL(link.href, page.finalUrl)
      return /^https?:$/.test(resolved.protocol) && !sameSite(resolved.hostname, home.hostname)
    } catch {
      return false
    }
  })
}

/* ------------------------------------------------------------------------- *
 * Fetching it
 * ------------------------------------------------------------------------- */

/** Read at most MAX_BYTES, then stop. The checker's reader, with a tighter cap. */
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

interface Fetched {
  html: string | null
  status: number | null
  outcome: AttemptOutcome
}

async function fetchCandidate(url: string, timeoutMs: number): Promise<Fetched> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent(),
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de,en;q=0.8',
      },
    })

    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return { html: null, status: response.status, outcome: 'http-error' }
    }

    // A PDF Impressum is a real Impressum and we cannot read it. Saying so is
    // honest; guessing at it from the URL would not be.
    const type = response.headers.get('content-type') ?? ''
    if (type && !/html|xml/i.test(type)) {
      await response.body?.cancel().catch(() => {})
      return { html: null, status: response.status, outcome: 'not-imprint' }
    }

    return { html: await readCapped(response), status: response.status, outcome: 'imprint' }
  } catch {
    return { html: null, status: null, outcome: 'failed' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Is what came back actually an Impressum?
 *
 * The hard case is the soft 404: a single-page app answers 200 for every path
 * and hands back the same shell, so `/impressum` "exists" on a site that has
 * none. The marker test alone cannot separate them — the homepage contains the
 * word "Impressum" too, in the footer link we followed. Comparing the opening
 * text against the homepage's is what actually decides it.
 */
function looksLikeImprint(html: string, homeText: string): boolean {
  const text = textOf(html)
  if (!IMPRINT_MARKER.test(text)) return false
  if (NOT_FOUND.test(text.slice(0, 2000))) return false
  return text.slice(0, 2000) !== homeText.slice(0, 2000)
}

/* ------------------------------------------------------------------------- *
 * What the Impressum names
 * ------------------------------------------------------------------------- */

/**
 * A postal code and a town. The negative lookahead drops 00000, which is not a
 * German postal code and is a common placeholder.
 */
const PLZ_CITY = /\b(?!00000)\d{5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+(?:[ -][A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+){0,2}/
/** A street with a house number on it. */
const STREET =
  /\b[A-Za-zÄÖÜäöüß.-]{2,30}(?:stra(?:ß|ss)e|str\.|weg|allee|platz|gasse|ring|damm|ufer|chaussee|steig|hof)\s+\d{1,4}\s*[a-zA-Z]?\b/i

/**
 * Both halves, or neither.
 *
 * A postal code on its own appears in any footer, on any page, of any business
 * — including ones whose Impressum states no address at all. A street on its
 * own appears in directions. Requiring both is what makes this worth reporting.
 *
 * A Postfach deliberately does not count. §5 TMG asks for an address a summons
 * can be served at, and a PO box is not one.
 */
function detectAddress(text: string): boolean {
  return PLZ_CITY.test(text) && STREET.test(text)
}

/**
 * German phone numbers.
 *
 * The dot is missing from the separator class on purpose. Include it and
 * `01.02.2024` is a phone number — and a legal notice is full of dates.
 */
const PHONE_TEXT = /(?:\+49|0049|\(0\)|\b0)[\s\-/()]*\d(?:[\s\-/()]*\d){5,14}/

function detectPhone(html: string, text: string): string | null {
  const linked = html.match(/href=["']tel:([^"']+)["']/i)?.[1]
  const candidate = linked ?? text.match(PHONE_TEXT)?.[0] ?? null
  if (!candidate) return null

  const digits = candidate.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return candidate.trim().slice(0, 40)
}

const EMAIL =
  /\b[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi

/**
 * Filenames that satisfy the email pattern.
 *
 * `logo@2x.png` matches it exactly — a retina asset is a valid-looking address
 * whose top-level domain is `png`. Every site built in the last decade has one,
 * so this list is not an optimisation.
 */
const NOT_A_TLD = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  'css', 'js', 'json', 'xml', 'html', 'htm', 'php', 'map', 'min',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm', 'pdf', 'zip',
])

/** Addresses that belong to the toolchain rather than to the business. */
const NOT_A_CONTACT =
  /^(no-?reply|noreply|postmaster|abuse|hostmaster|webmaster|wordpress|admin@localhost|sentry)/i
const NOT_A_HOST = /(sentry\.io|wixpress\.com|example\.(com|org|de)|localhost|domain\.tld|ihre-domain)/i

/** The obfuscations German legal notices favour. They satisfy §5; they are not usable. */
const OBFUSCATED_EMAIL =
  /[a-z0-9._%+-]+\s*(?:\(at\)|\[at\]|\{at\}|\s+at\s+)\s*[a-z0-9.-]+\s*(?:\(dot\)|\[dot\]|\s+dot\s+|\.)\s*[a-z]{2,24}/i

/** Addresses a business publishes for the public, as opposed to a person's. */
const ROLE_ADDRESS = /^(info|kontakt|contact|office|mail|email|buero|b[üu]ro|praxis|kanzlei|post|service|anfrage)@/i

function collectEmails(html: string, text: string): string[] {
  const found: string[] = []
  for (const match of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    found.push(decodeURIComponent(match[1]))
  }
  for (const match of text.matchAll(EMAIL)) found.push(match[0])

  const clean = found
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length <= 254)
    .filter((entry) => !NOT_A_TLD.has(entry.split('.').pop() ?? ''))
    .filter((entry) => !NOT_A_CONTACT.test(entry))
    .filter((entry) => !NOT_A_HOST.test(entry))

  return [...new Set(clean)]
}

/**
 * Which address to keep.
 *
 * Role addresses first — `info@` over `h.mueller@`. That ordering is chosen
 * twice over: it is the address a business would rather be written to, and it
 * is the one that is not a named individual's personal data. Only when a site
 * offers nothing else does a personal address get stored.
 */
function pickEmail(emails: string[], host: string): string | null {
  if (!emails.length) return null
  const role = emails.find((entry) => ROLE_ADDRESS.test(entry))
  if (role) return role
  const own = emails.find((entry) => sameSite(entry.split('@')[1] ?? '', host))
  return own ?? emails[0]
}

const VAT_LABEL =
  /(USt[-\s.]?IdNr|Umsatzsteuer[-\s]?Identifikationsnummer|Umsatzsteuer[-\s]?ID|VAT[-\s]?(?:ID|No|Nr))/i
/**
 * A German VAT number, and its Austrian and Swiss equivalents.
 *
 * `\b...\b` around exactly nine digits is what keeps an IBAN out: DE followed
 * by twenty digits has no word boundary nine characters in. A Steuernummer
 * (12/345/67890) is a different number under a different obligation and must
 * not count as this one.
 */
const VAT_NUMBER = /\bDE\s?[0-9]{9}\b|\bATU[0-9]{8}\b|\bCHE-?[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}\b/

function detectVatId(text: string): boolean {
  return VAT_NUMBER.test(text) || (VAT_LABEL.test(text) && /\b[A-Z]{2}\s?[0-9]{8,9}\b/.test(text))
}

/* ------------------------------------------------------------------------- *
 * What the page loads
 * ------------------------------------------------------------------------- */

const PRIVACY_HREF = /(^|[/?#._-])(datenschutz|datenschutzerkl|privacy|privacy-?policy|dse)(\b|[/?#._-]|$)/i
const PRIVACY_TEXT = /(datenschutz|privacy policy|privacy notice)/i
const PRIVACY_HEADING = /datenschutzerkl[äa]rung/i

/**
 * Is a privacy policy linked?
 *
 * A real destination is required — not `#`, not `javascript:`. That one test is
 * what separates the link from the "Datenschutzeinstellungen" button a cookie
 * banner puts in the same footer, which goes nowhere and is not a policy.
 *
 * The policy itself is never fetched, so this measures "is linked", not "exists
 * and is adequate". The finding has to be worded to match.
 */
function detectPrivacyLink(links: Anchor[]): boolean {
  return links.some((link) => {
    if (/^(javascript:|#|mailto:|tel:)/i.test(link.href)) return false
    return PRIVACY_HREF.test(link.href) || PRIVACY_TEXT.test(link.text)
  })
}

const GOOGLE_FONTS = /(?:href|src)\s*=\s*["'][^"']*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/i
const GOOGLE_FONTS_IMPORT = /@import[^;]*fonts\.(?:googleapis|gstatic)\.com/i

function detectExternalFonts(html: string): boolean {
  return GOOGLE_FONTS.test(html) || GOOGLE_FONTS_IMPORT.test(html)
}

const MAPS_URL = /(?:google\.[a-z.]+\/maps|maps\.google\.|\/maps\/embed)/i

/**
 * A Google Maps frame in the delivered markup.
 *
 * `src` only. A consent tool leaves `src` empty and parks the real URL in
 * `data-src` until the visitor agrees, so reading both would report every
 * correctly-implemented site as embedding maps unasked — the exact opposite of
 * the truth.
 */
function detectExternalMaps(html: string): boolean {
  for (const match of html.matchAll(/<iframe\b([^>]*)>/gi)) {
    if (MAPS_URL.test(attribute(match[1], 'src'))) return true
  }
  return false
}

const CONSENT_TOOLS: [string, RegExp][] = [
  ['Borlabs', /borlabs-cookie/i],
  ['Cookiebot', /cookiebot/i],
  ['Usercentrics', /usercentrics/i],
  ['Klaro', /\bklaro\b/i],
  ['Complianz', /cmplz|complianz/i],
  ['CookieFirst', /cookiefirst/i],
  ['consentmanager', /consentmanager/i],
  ['Cookie Consent', /cookie-?consent/i],
]

function detectConsentManager(html: string): string | null {
  for (const [name, pattern] of CONSENT_TOOLS) {
    if (pattern.test(html)) return name
  }
  return null
}

const SEARCH_FORM = /(role\s*=\s*["']search["']|type\s*=\s*["']search["']|[?&]s=)/i
/** A form that collects something about a person, as opposed to a search box. */
const COLLECTS_PERSONAL_DATA =
  /(<textarea\b|type\s*=\s*["'](?:email|tel)["']|name\s*=\s*["'][^"']*(?:name|mail|tel|phone|nachricht|message|betreff|anfrage)[^"']*["'])/i

function forms(html: string): string[] {
  return [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((match) => match[0])
}

function detectContactForm(html: string): boolean {
  return forms(html).some((form) => !SEARCH_FORM.test(form) && COLLECTS_PERSONAL_DATA.test(form))
}

function detectFormPostingToHttp(html: string): boolean {
  return forms(html).some((form) => {
    if (SEARCH_FORM.test(form)) return false
    const tag = form.match(/<form\b[^>]*>/i)?.[0] ?? ''
    return /^http:\/\//i.test(attribute(tag, 'action'))
  })
}

/**
 * A form on a page that does not encrypt it.
 *
 * Null when the checker had to fall back to plain http because the certificate
 * would not verify. That site is not sending forms in the clear — it is serving
 * TLS with a broken certificate, which `invalid_certificate` already says. One
 * fault, one finding, and no claim that would be wrong if it were checked.
 */
function detectInsecureForm(page: FetchedPage): boolean | null {
  if (page.fetchedOverHttp) return null
  if (!page.isHttps) return detectContactForm(page.html)
  // Encrypted page, unencrypted destination: the classic mixed-content leak,
  // and what stops this check being a restatement of `no_https`.
  return detectFormPostingToHttp(page.html)
}

/* ------------------------------------------------------------------------- *
 * The pass
 * ------------------------------------------------------------------------- */

/**
 * Read a business's legal notice, and what its homepage loads.
 *
 * Never throws, like the checker: every failure is recorded as a measurement so
 * that a bad network cannot manufacture a finding.
 */
export async function measureImprint(page: FetchedPage): Promise<ImprintMeasurement> {
  const started = Date.now()
  const result = blank('error', null)
  const deadline = started + BUDGET_MS

  try {
    const homeLinks = anchors(page.html)
    const homeText = textOf(page.html)

    /*
     * A page with almost no anchors is a client-rendered shell — the markup is
     * a loading div and the footer arrives from JavaScript. The ABSENCE of an
     * Impressum link there proves nothing, and this flag is what stops that
     * absence becoming an accusation. It matters most for exactly the sites the
     * operator least wants at the top of his list: the modern, well-built ones.
     */
    result.linksReadable = homeLinks.length >= MIN_ANCHORS

    result.loadsExternalFonts = detectExternalFonts(page.html)
    result.hasExternalMaps = detectExternalMaps(page.html)
    result.consentManager = detectConsentManager(page.html)
    result.contactFormInsecure = detectInsecureForm(page)

    const privacyOnHome = detectPrivacyLink(homeLinks)

    const queue = candidates(page, homeLinks)
    let imprintHtml: string | null = null
    let imprintUrl: string | null = null

    for (const candidate of queue) {
      if (Date.now() >= deadline) break

      if (candidate.onPage) {
        // Already in hand. The Impressum is a section of the homepage.
        imprintHtml = page.html
        imprintUrl = candidate.url
        result.attempts.push({ url: candidate.url, status: null, outcome: 'imprint' })
        break
      }

      // The checker knocked on this host moments ago; give it a breath before
      // knocking again.
      await sleep(COURTESY_MS)

      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const attempt = await fetchCandidate(candidate.url, Math.min(TIMEOUT_MS, remaining))

      if (attempt.html && looksLikeImprint(attempt.html, homeText)) {
        imprintHtml = attempt.html
        imprintUrl = candidate.url
        result.attempts.push({ url: candidate.url, status: attempt.status, outcome: 'imprint' })
        break
      }

      result.attempts.push({
        url: candidate.url,
        status: attempt.status,
        outcome: attempt.html ? 'soft-404' : attempt.outcome,
      })
    }

    if (imprintHtml && imprintUrl) {
      const text = textOf(imprintHtml)
      const emails = collectEmails(imprintHtml, text)
      const obfuscated = OBFUSCATED_EMAIL.test(text)

      result.state = 'found'
      result.imprintUrl = imprintUrl
      result.hasAddress = detectAddress(text)
      result.hasVatId = detectVatId(text)
      result.phone = detectPhone(imprintHtml, text)
      result.hasPhone = result.phone !== null

      /*
       * An obfuscated address satisfies the obligation, so `hasEmail` is true —
       * but it is deliberately not reconstructed into `email`. A guessed
       * address is worse than none: writing to it fails silently, and the
       * operator would never learn the lead was never contacted.
       */
      result.email = pickEmail(emails, new URL(page.finalUrl).hostname)
      result.hasEmail = result.email !== null || obfuscated

      result.hasPrivacyPolicy =
        privacyOnHome ||
        detectPrivacyLink(anchors(imprintHtml)) ||
        PRIVACY_HEADING.test(text) ||
        (result.linksReadable ? false : null)
    } else if (hasOffsiteImprintLink(page, homeLinks)) {
      result.state = 'error'
      result.error = 'The only imprint link points off this site.'
      result.hasPrivacyPolicy = privacyOnHome || (result.linksReadable ? false : null)
    } else if (result.linksReadable) {
      result.state = 'absent'
      result.hasPrivacyPolicy = privacyOnHome
    } else {
      result.state = 'error'
      result.error = 'The page is assembled in the browser; there were no links to read.'
      result.hasPrivacyPolicy = privacyOnHome || null
    }
  } catch (error) {
    result.state = 'error'
    result.error = error instanceof Error ? error.message : 'The imprint lookup failed.'
  }

  result.durationMs = Date.now() - started
  return result
}
