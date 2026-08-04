import { type FindingCode } from '@/lib/enrichment/vocabulary'

/*
 * The pre-save website check.
 *
 * Deliberately NOT `lib/enrichment/checker.ts`, and the difference is the
 * budget rather than the subject. The audit runs on a lead the operator has
 * already decided to keep: it opens a TLS socket for the certificate's expiry
 * date, resolves the domain separately to tell a dead registration from a dead
 * server, probes /favicon.ico, and takes as long as it takes. This runs on a
 * business nobody has decided anything about yet, hundreds of times in a row, to
 * answer one question — is there anything here worth saving? One request, eight
 * seconds, one retry if the connection itself failed, then a verdict.
 *
 * So it is a cheaper instrument pointed at the same faults, and it reports them
 * in the same words: the signals below are `FindingCode` values from
 * `lib/enrichment/vocabulary.ts`, the vocabulary `lead_audit_findings` is
 * written in. A lead saved because this found `no_https` still says `no_https`
 * when the full audit confirms it a minute later. A private list here would
 * have meant translating between two names for one fault for ever.
 *
 * THREE RULES, and they are what the caller is allowed to assume:
 *
 *   1. It never throws. Every failure — a malformed URL, a refused connection,
 *      a timeout, a certificate nobody renewed — comes back as a result with
 *      `reachable: false` and something in `signals`. A batch of fifty must not
 *      be lost because the third one was `htp://`.
 *   2. It never runs more than `MAX_CONCURRENCY` requests at once. These are
 *      unattended requests to small businesses' servers made in the operator's
 *      name, and fifty at once from one IP is a thing to answer for.
 *   3. It depends on nothing server-only. `fetch` and `URL` and no more, so the
 *      whole thing can be driven from a terminal — `node scripts/site-check-demo.mjs` —
 *      against real sites, which is the only way to find out that a heuristic
 *      is wrong before it decides what gets saved.
 */

/** One request, start to finish. The spec's eight seconds. */
const TIMEOUT_MS = 8_000

/**
 * One more go, and only ever one.
 *
 * A refused connection is not always an answer about the business. A DNS
 * resolver that blinks, a TCP reset, a serverless instance that has just come up
 * cold — all of them arrive here as the same `TypeError: fetch failed` that a
 * genuinely dead server produces, and the consequence of believing the transient
 * one is a lead saved for `site_unreachable` against a business whose website is
 * fine. That is the expensive mistake in this whole check: it is written to
 * `weakness_signals`, it is what the operator reads before he rings, and nothing
 * about the row says the verdict came from a single failed connection.
 *
 * ONE retry, not three, because the second failure is evidence and the fourth is
 * just cost. And it is worth stating what is NOT retried, since both are
 * failures this would otherwise double the price of:
 *
 *   A certificate fault      is a determinate answer. The server is there and
 *                            answering; what it presents will not verify, and it
 *                            will not verify the second time either.
 *   A timeout                is already eight seconds spent. Retrying takes one
 *                            business to sixteen, and at a concurrency of five
 *                            that is a whole worker held on the one result the
 *                            run is least likely to want. A site that cannot
 *                            answer in eight seconds has told us something true.
 */
const RETRIES = 1

/**
 * Long enough for a blip to pass, short enough to be invisible.
 *
 * Retrying instantly would hit the same half-second of whatever went wrong; a
 * full second would show up in the deadline arithmetic across a batch of fifty.
 */
const RETRY_DELAY_MS = 300

/**
 * Never more than this many sites in flight.
 *
 * Not a performance number. It is the difference between a tool that reads
 * fifty websites over half a minute and a tool that arrives at fifty servers
 * simultaneously from one address — which is what an abuse filter is built to
 * catch, and would be right to.
 */
export const MAX_CONCURRENCY = 5

/**
 * Enough for <head> and a footer. A refusal to download somebody's hero video.
 *
 * Everything read below is in the first few KB or in the last few; a page that
 * exceeds this gets its footer truncated, which costs one signal and never a
 * wrong one — `detectStaleCopyright` returns null rather than a guess.
 */
const MAX_BYTES = 256 * 1024

/**
 * A footer year this far behind means nobody is home.
 *
 * Three, where `AUDIT_THRESHOLDS.staleCopyrightYears` is two, and the gap is
 * deliberate rather than an oversight. That threshold decides whether to put a
 * fault on a diagnosis the operator will read; this one decides whether to put
 * a business in the book at all. The second is the more expensive mistake — a
 * lead saved on a weak signal is a call that wastes an afternoon — so it asks
 * for a year more of neglect before it counts as one.
 */
const STALE_COPYRIGHT_YEARS = 3

/**
 * What this check can find. A subset of the audit's vocabulary, not a new one.
 *
 * Nine, and each maps to one of the five things the storage rule asks about.
 * Nothing here is a judgement about how bad the fault is — severity is a
 * property of the code and lives with the code, in `FINDING_SPECS`.
 */
export type WeaknessSignal = Extract<
  FindingCode,
  | 'site_unreachable'
  | 'http_error'
  | 'no_https'
  | 'invalid_certificate'
  | 'not_mobile_friendly'
  | 'free_subdomain'
  | 'social_only'
  | 'diy_platform'
  | 'stale_copyright'
>

export interface SiteCheckResult {
  /** The URL as it was handed in, verbatim, so a result can be matched back to its place. */
  url: string
  /** After normalisation — a bare `example.de` becomes `https://example.de/`. Null when unparseable. */
  requestedUrl: string | null
  /** Where the redirects ended. Null unless the site answered. */
  finalUrl: string | null
  /**
   * Did a server hand us a page.
   *
   * False for a refused connection, a timeout, a 404, a 500 and a certificate
   * that will not verify alike. True says only that bytes arrived — a reachable
   * site can still carry every other signal in the list.
   */
  reachable: boolean
  httpStatus: number | null
  durationMs: number
  /**
   * The faults found, worst first. Empty is the interesting case: it means the
   * business has a working website and there is nothing to sell it.
   */
  signals: WeaknessSignal[]
  /** Why it failed, when it did. Evidence for the signal, never a substitute for one. */
  error: string | null
}

/* ------------------------------------------------------------------------- *
 * Hosts that are not a website
 * ------------------------------------------------------------------------- */

/**
 * Somebody else's profile, offered as a website.
 *
 * `business.site` and `g.page` are in here rather than among the builders on
 * purpose: a Google Business page is not a site the owner controls, cannot be
 * changed without Google's permission, and disappears when Google decides. That
 * is the same conversation as a Facebook page, not the same as Wix.
 */
const SOCIAL_HOSTS: RegExp[] = [
  /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)(linktr\.ee|bio\.link|beacons\.ai|campsite\.bio|taplink\.cc|linkin\.bio)$/i,
  /(^|\.)(business\.site|g\.page)$/i,
  /^sites\.google\.com$/i,
  /(^|\.)(yelp\.[a-z.]+|gelbeseiten\.de|dasoertliche\.de|11880\.com|cylex\.de|wlw\.de|meinestadt\.de|golocal\.de)$/i,
]

/**
 * A builder's subdomain, handed out on the builder's own name.
 *
 * Not the same question as which platform the site runs on. A business can run
 * Wix on its own domain and that is fine; `krause-fliesen.wixsite.com` painted
 * on the side of a van is the fault. The list is the spec's, plus the ones that
 * turn up beside them.
 */
const PROVIDER_SUBDOMAIN_HOSTS: RegExp[] = [
  /\.wixsite\.com$/i,
  /\.(jimdosite\.com|jimdofree\.com|jimdo\.com)$/i,
  /\.jouwweb\.[a-z.]+$/i,
  /\.webnode\.[a-z.]+$/i,
  /\.weebly\.com$/i,
  /\.myshopify\.com$/i,
  /\.wordpress\.com$/i,
  /\.squarespace\.com$/i,
  /\.blogspot\.[a-z.]+$/i,
  /\.strikingly\.com$/i,
  /\.tilda\.ws$/i,
  /\.systeme\.io$/i,
]

/**
 * The footer a builder writes when nobody has paid to remove it.
 *
 * German and English both, because the market is German and the builders are
 * not. Matched against the tail of the page, where a footer is — grepping the
 * whole document would hit a blog post about Wix and call it a Wix site.
 */
const BUILDER_FOOTER_PATTERNS: RegExp[] = [
  /diese\s+(website|seite|homepage)\s+wurde\s+mit\s+/i,
  /erstellt\s+mit\s+(jimdo|wix|webnode|weebly|jouwweb|strikingly)/i,
  /kostenlose?\s+(homepage|website)\s+von\s+/i,
  /powered\s+by\s+(wix|jimdo|webnode|weebly|jouwweb|shopify|strikingly|squarespace|blogger)/i,
  /(create|build)\s+your\s+own\s+(free\s+)?website/i,
  /make\s+a\s+free\s+website/i,
  /proudly\s+powered\s+by\s+wordpress/i,
  /this\s+site\s+was\s+(designed|created)\s+with\s+the\s+/i,
]

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

/**
 * What kind of address this is, judged from a host.
 *
 * Run against the FINAL host wherever one is known. A business whose own domain
 * redirects to its Facebook page has, in every sense a sales call cares about,
 * a Facebook page — and the redirect is what proves it.
 */
function hostSignal(url: URL): WeaknessSignal | null {
  const host = url.hostname.toLowerCase()
  if (matchesAny(SOCIAL_HOSTS, host)) return 'social_only'
  if (matchesAny(PROVIDER_SUBDOMAIN_HOSTS, host)) return 'free_subdomain'
  return null
}

/* ------------------------------------------------------------------------- *
 * Reading the page
 * ------------------------------------------------------------------------- */

/** Google hands back bare hostnames often enough to be worth tolerating. */
function normalizeUrl(website: string): URL | null {
  const trimmed = website.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    // Anything that is not http(s) — `mailto:`, `tel:`, a stray `ftp:` — is not
    // a website, and following it would be a category error rather than a check.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * Read at most MAX_BYTES of the body, then stop and let the rest go.
 *
 * `response.text()` would buy the whole page. The reader is cancelled rather
 * than merely abandoned, which is what actually closes the socket — an
 * abandoned reader holds the connection open until the timeout fires, and at a
 * concurrency of five that is four slots doing nothing.
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
  } catch {
    // A body that dies mid-stream still told us the server answered. Whatever
    // arrived is worth reading; the signals it cannot support stay unset.
  } finally {
    await reader.cancel().catch(() => {})
  }

  return chunks.join('')
}

/**
 * A viewport declaration — the cheapest honest mobile signal there is.
 *
 * THE RULE IS THE TAG'S PRESENCE, not its contents, and that is a deliberate
 * difference from `detectViewport` in the audit's checker. That one demands
 * `width=device-width` and is right to: it is describing a page, and a page
 * without it is measurably worse on a phone.
 *
 * This one is deciding whether to put a business in the book, so a false
 * positive costs an afternoon on the phone telling somebody their perfectly
 * responsive site is not mobile. `<meta name="viewport" content="initial-scale=1">`
 * is a real and common way to write a responsive page — wikipedia.org writes it
 * that way — and the stricter test flags it. Once was enough to find that out;
 * `node scripts/site-check-demo.mjs` is what found it.
 *
 * The one exception is a viewport pinned to a fixed pixel width. `width=980` is
 * not an alternative style, it is a desktop layout declaring itself, and it is
 * the shape a 2011 template ships.
 */
function isMobileFriendly(html: string): boolean {
  const tag = html.match(/<meta[^>]+name=["']?viewport["']?[^>]*>/i)?.[0]
  if (!tag) return false

  const content = tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
  const fixedWidth = content.match(/width\s*=\s*(\d+)/i)
  return !fixedWidth
}

/**
 * The footer year — the abandonment tell.
 *
 * Only years attached to a copyright marker count. Grepping for any 20xx would
 * match a phone number, a price or a news date, and turn the strongest signal
 * in the check into noise. A range ("2019–2024") reports its later end, which
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

/** The last stretch of the page, where a footer lives. */
function tailOf(html: string): string {
  return html.length > 8_000 ? html.slice(-8_000) : html
}

/* ------------------------------------------------------------------------- *
 * Was it the certificate?
 * ------------------------------------------------------------------------- */

/** Node's vocabulary for "the certificate is the problem", as undici surfaces it. */
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

/**
 * Walk the cause chain looking for a certificate complaint.
 *
 * `fetch` reports every transport failure as the same flat `TypeError: fetch failed`
 * and hangs the real reason off `cause`, sometimes two deep. Without this, an
 * expired certificate and a refused connection are the same error object — and
 * they are not the same conversation: one business let its certificate lapse,
 * the other has no server. The first is a sale.
 */
function certificateFault(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code
    if (typeof code === 'string' && CERT_ERROR_CODES.has(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    const detail = cause instanceof Error ? `: ${cause.message}` : ''
    return `${error.message}${detail}`.slice(0, 300)
  }
  return String(error).slice(0, 300)
}

/**
 * Identify honestly. A checker that pretends to be Chrome is a checker whose
 * operator cannot answer for what it did.
 *
 * A different string from the audit's on purpose. They are different visitors
 * with different budgets, and a site owner reading their logs should be able to
 * tell the one that arrived once from the one that came back every week.
 */
export const USER_AGENT = 'LeadEngineTriage/1 (+internal prospecting tool)'

/* ------------------------------------------------------------------------- *
 * The check
 * ------------------------------------------------------------------------- */

/**
 * One site, one request, a verdict either way.
 *
 * Never throws. That is not politeness, it is the contract the batch depends
 * on: fifty of these run concurrently and a rejection anywhere would take the
 * whole run down over one business with a typo in its Google listing.
 */
export async function checkSite(
  url: string,
  options: { signal?: AbortSignal } = {},
): Promise<SiteCheckResult> {
  const started = Date.now()

  const target = normalizeUrl(url)
  if (!target) {
    return {
      url,
      requestedUrl: null,
      finalUrl: null,
      reachable: false,
      httpStatus: null,
      durationMs: Date.now() - started,
      signals: ['site_unreachable'],
      error: 'The stored website is not a URL.',
    }
  }

  /*
   * Judge the address before spending a request on it.
   *
   * A Facebook page is a finished answer: it will resolve, it will serve HTTPS,
   * it will pass every markup test, and none of that changes the fact that the
   * business has no website. Fetching it would cost eight seconds to learn what
   * the hostname already said.
   *
   * Computed once and copied per attempt. These are facts about the URL rather
   * than about any particular request, so a retry must start from them — and
   * must not start from whatever the failed attempt had accumulated on top.
   */
  const address = new Set<WeaknessSignal>()
  const addressSignal = hostSignal(target)
  if (addressSignal) address.add(addressSignal)
  if (target.protocol === 'http:') address.add('no_https')

  let lastError: unknown = null
  let timedOut = false

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const signals = new Set(address)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      /*
       * A GET, not a HEAD. Three of the five things the rule asks about are in
       * the markup — the viewport tag, the builder footer, the copyright year —
       * and a HEAD would answer none of them, so the second request it saves is a
       * request it would immediately have to make again. `readCapped` is what
       * keeps this lean: the headers and the first 256KB, then the socket closes.
       */
      const response = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          // Compressed markup is most of the saving on a page like this.
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'de,en;q=0.8',
        },
      })

      const finalUrl = new URL(response.url || target.href)

      // Re-judge on the destination: a domain that redirects to a Facebook page
      // has one, and the redirect is the proof.
      const finalSignal = hostSignal(finalUrl)
      if (finalSignal) signals.add(finalSignal)
      // Including a redirect that lands on plaintext, which the first check could
      // not have seen — the operator typed https and got http.
      if (finalUrl.protocol === 'http:') signals.add('no_https')

      if (!response.ok) {
        /*
         * NOT retried, and this is the one that looks like it should be. A 503
         * is a server that answered — it resolved, it connected, it chose to say
         * no — and `http_error` is a true statement about a visitor's experience
         * of that site today. Retrying would also double the cost of the one
         * failure mode a rate limiter produces, which is the last thing to
         * respond to by asking again.
         */
        signals.add('http_error')
        return {
          url,
          requestedUrl: target.href,
          finalUrl: finalUrl.href,
          reachable: false,
          httpStatus: response.status,
          durationMs: Date.now() - started,
          signals: ordered(signals),
          error: `The server answered ${response.status}.`,
        }
      }

      const html = await readCapped(response)

      if (!isMobileFriendly(html)) signals.add('not_mobile_friendly')

      if (matchesAny(BUILDER_FOOTER_PATTERNS, tailOf(html))) signals.add('diy_platform')

      const year = detectCopyrightYear(html)
      if (year !== null && new Date().getFullYear() - year > STALE_COPYRIGHT_YEARS) {
        signals.add('stale_copyright')
      }

      return {
        url,
        requestedUrl: target.href,
        finalUrl: finalUrl.href,
        reachable: true,
        httpStatus: response.status,
        durationMs: Date.now() - started,
        signals: ordered(signals),
        error: null,
      }
    } catch (error) {
      lastError = error

      /*
       * A bad certificate is not an unreachable site, and conflating them would
       * lose the better of the two conversations. The server is there and
       * answering; what it presents will not verify, which every visitor's
       * browser has been shouting at them in red for however long it has been
       * expired. `site_unreachable` is not added: nothing about this says the
       * business has no server.
       */
      const cert = certificateFault(error)
      if (cert) {
        signals.add('invalid_certificate')
        return {
          url,
          requestedUrl: target.href,
          finalUrl: null,
          reachable: false,
          httpStatus: null,
          durationMs: Date.now() - started,
          signals: ordered(signals),
          error: `The certificate does not verify (${cert}).`,
        }
      }

      timedOut = controller.signal.aborted
      // Eight seconds is an answer. See the note on RETRIES.
      if (timedOut) break
      /*
       * The batch is already over. The pool's contract is that an in-flight
       * request finishes rather than being cut off, and a retry is not in
       * flight — it is new work, started after the caller said stop, against a
       * deadline the response has to be written inside.
       */
      if (options.signal?.aborted) break
    } finally {
      clearTimeout(timer)
    }

    if (attempt < RETRIES) await delay(RETRY_DELAY_MS)
  }

  const signals = new Set(address)
  signals.add('site_unreachable')
  return {
    url,
    requestedUrl: target.href,
    finalUrl: null,
    reachable: false,
    httpStatus: null,
    durationMs: Date.now() - started,
    signals: ordered(signals),
    error: timedOut ? `No answer within ${TIMEOUT_MS / 1000}s.` : messageOf(lastError),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Worst first, then alphabetically, so two runs over the same site produce the
 * same array and a stored `weakness_signals` can be compared without sorting.
 */
const SIGNAL_ORDER: WeaknessSignal[] = [
  'site_unreachable',
  'http_error',
  'invalid_certificate',
  'no_https',
  'social_only',
  'not_mobile_friendly',
  'free_subdomain',
  'stale_copyright',
  'diy_platform',
]

function ordered(signals: Set<WeaknessSignal>): WeaknessSignal[] {
  return SIGNAL_ORDER.filter((signal) => signals.has(signal))
}

/* ------------------------------------------------------------------------- *
 * The batch
 * ------------------------------------------------------------------------- */

/**
 * Check many sites, never more than `concurrency` at once, in input order.
 *
 * A worker pool rather than chunks of five. Chunking would make every batch as
 * slow as its slowest member — one site that sits there for the full eight
 * seconds would hold four finished workers idle — and these timeouts are not
 * rare, they are the signal we came for.
 *
 * Results are positionally aligned with `urls`, including duplicates. The
 * caller is matching them against businesses, and a filtered array would put
 * the wrong verdict on the wrong one.
 *
 * `signal` stops the pool starting anything NEW; in-flight requests are left to
 * finish, since they are already paid for and a few hundred milliseconds from
 * an answer. Positions never reached are left EMPTY rather than filled with a
 * default — see the note on the return type. A hole is a business nobody looked
 * at, and the caller must be able to tell that from a clean bill of health.
 */
export async function checkSites(
  urls: string[],
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<(SiteCheckResult | undefined)[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? MAX_CONCURRENCY, MAX_CONCURRENCY))
  const results = new Array<SiteCheckResult | undefined>(urls.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      if (options.signal?.aborted) return
      const index = next
      next += 1
      if (index >= urls.length) return
      // `checkSite` does not throw, so nothing here needs a catch — and if that
      // ever stops being true, the pool must not be the thing that discovers it.
      //
      // The signal goes down as well as being read up here. It never cancels the
      // request in flight — that is the contract below — but it does stop a
      // failed one being tried a second time after the batch is over.
      results[index] = await checkSite(urls[index], { signal: options.signal })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return results
}
