import type { Measurement } from '@/lib/enrichment/checker'
import type { PageSpeed } from '@/lib/enrichment/pagespeed'
import {
  AUDIT_THRESHOLDS,
  FINDING_SPECS,
  type FindingCode,
  type FindingCategory,
  type FindingSeverity,
} from '@/lib/enrichment/vocabulary'

/*
 * The judgements. Everything the checker measured, turned into things worth
 * saying to a business owner.
 *
 * Pure — no network, no database, no clock beyond the current year. That is
 * what makes the criteria arguable: they are a function of a measurement, so
 * changing one's mind about a threshold is an edit here and a re-run, not an
 * archaeology exercise across a parser and a query builder.
 *
 * Three rules hold throughout:
 *
 *   1. A check that could not be evaluated emits NOTHING. A site that never
 *      answered has not told us it lacks a favicon, and inventing a passing or
 *      failing row for it would be a lie that filters and sorts.
 *   2. A check that could be evaluated emits a row either way. The passing rows
 *      are what let the diagnosis say "and these are fine" out loud, and what
 *      makes "nothing found" provable rather than merely empty.
 *   3. Every failing row carries the evidence that produced it. A PageSpeed
 *      score of 23 is a sales argument; "slow" is an opinion.
 */

export interface Finding {
  code: FindingCode
  category: FindingCategory
  /**
   * The severity the CODE carries, written onto passing rows as well as
   * failing ones. It describes the check, not the outcome — which is what lets
   * an old audit still be read under today's vocabulary, and lets a later
   * question like "which criticals did this site pass" be asked at all.
   */
  severity: FindingSeverity
  passed: boolean
  value: Record<string, unknown> | null
  message: string
}

function finding(
  code: FindingCode,
  passed: boolean,
  message: string,
  value: Record<string, unknown> | null = null,
): Finding {
  const spec = FINDING_SPECS[code]
  return { code, category: spec.category, severity: spec.severity, passed, value, message }
}

function host(url: string | null): string {
  if (!url) return 'the site'
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace(/\.0$/, '')
}

/** Site builders, as opposed to a CMS somebody hired a developer for. */
const DIY_PLATFORMS = new Set(['wix', 'jimdo', 'squarespace', 'weebly', 'google-sites', 'ionos'])

const SOCIAL_MESSAGES: Record<string, (site: string) => string> = {
  facebook: (site) =>
    `The only web presence is a Facebook page (${site}). It ranks badly, the business does not own it, and Facebook decides what sits next to it.`,
  instagram: (site) =>
    `The only web presence is an Instagram profile (${site}). There is nowhere to put opening hours, prices, or a contact form.`,
  linktree: (site) =>
    `The only web presence is a Linktree (${site}) — a list of links standing in for a website.`,
  google_business: (site) =>
    `The only web presence is an auto-generated Google business page (${site}). Google wrote it, and Google can withdraw it.`,
  directory: (site) =>
    `The only web presence is a directory listing on ${site} — a page the business does not own and cannot change.`,
}

/* ------------------------------------------------------------------------- *
 * The fast pass
 * ------------------------------------------------------------------------- */

/**
 * Diagnose everything the checker learned at the front door.
 *
 * PageSpeed is judged separately, in `judgePerformance`, because it arrives
 * later — see the two-stage pass in `run.ts`.
 */
export function judgeMeasurement(measurement: Measurement, now = new Date()): Finding[] {
  // The checker itself broke. That says nothing about the business, so there is
  // nothing here to diagnose; `lead_audits.error` carries the reason.
  if (measurement.websiteStatus === 'error') return []

  const findings: Finding[] = []
  const site = host(measurement.finalUrl ?? measurement.websiteUrl)
  const raw = (measurement.raw ?? {}) as Record<string, unknown>

  /* ---- presence -------------------------------------------------------- */

  if (measurement.websiteStatus === 'no_website') {
    findings.push(
      finding(
        'no_website',
        false,
        'No website at all. Google Maps has no site on file for this business, so a customer who looks them up finds a pin and a phone number.',
      ),
    )
    // Nothing else was measurable. Everything below needs a site to look at.
    return findings
  }

  findings.push(finding('no_website', true, `A website is on record: ${site}.`))

  if (measurement.presenceKind) {
    const isSite = measurement.presenceKind === 'site'
    findings.push(
      finding(
        'social_only',
        isSite,
        isSite
          ? 'The address on file is a real website rather than a social profile.'
          : (SOCIAL_MESSAGES[measurement.presenceKind]?.(site) ??
            `The only web presence is ${site}, which is not a website the business owns.`),
        { kind: measurement.presenceKind, url: measurement.websiteUrl },
      ),
    )
  }

  /* ---- availability ---------------------------------------------------- */

  if (measurement.dnsResolves === false) {
    findings.push(
      finding(
        'dead_domain',
        false,
        `The domain ${site} no longer resolves. They had a website once and let it lapse — the address is still printed on their van and it leads nowhere.`,
        { hostname: site, url: measurement.websiteUrl },
      ),
    )
    return findings
  }

  if (measurement.dnsResolves === true) {
    findings.push(finding('dead_domain', true, `The domain ${site} resolves.`))
  }

  /* ---- trust, before availability ---------------------------------------
   *
   * The certificate is judged here rather than further down with the rest of
   * the trust checks, because it is the one verdict that does not depend on
   * the page being fetched — the handshake happens first and stands alone.
   *
   * That ordering is load-bearing. A certificate bad enough to make the fetch
   * fail leaves the site looking merely `unreachable`, and diagnosing it in
   * fetch order would return at the availability check below and throw away
   * the very finding that explains WHY nobody can reach it.
   */
  if (measurement.tlsValid !== null) {
    const expired = measurement.tlsExpiresAt ? new Date(measurement.tlsExpiresAt) : null
    const monthsAgo =
      expired && expired < now
        ? Math.round((now.getTime() - expired.getTime()) / (30 * 24 * 60 * 60 * 1000))
        : null

    findings.push(
      finding(
        'invalid_certificate',
        measurement.tlsValid,
        measurement.tlsValid
          ? 'The security certificate verifies.'
          : monthsAgo !== null
            ? `The security certificate expired ${monthsAgo} months ago, on ${expired!.toISOString().slice(0, 10)}. Every browser now shows a full-page red warning that has to be clicked through before anyone reaches the site.`
            : `The security certificate does not verify (${measurement.tlsError ?? 'rejected by the browser'}). Visitors get a full-page security warning before they reach the site.`,
        {
          expiresAt: measurement.tlsExpiresAt,
          expiredMonthsAgo: monthsAgo,
          error: measurement.tlsError,
        },
      ),
    )
  }

  const status = measurement.httpStatus

  if (measurement.websiteStatus === 'unreachable' && status === null) {
    findings.push(
      finding('site_unreachable', false, `${site} did not answer. ${measurement.error ?? ''}`.trim(), {
        error: measurement.error,
        url: measurement.websiteUrl,
      }),
    )
    return findings
  }

  if (status !== null) {
    findings.push(finding('site_unreachable', true, `${site} answered.`))

    const broken = status >= 400
    findings.push(
      finding(
        'http_error',
        !broken,
        broken
          ? `${site} answers with HTTP ${status} instead of a page. Anyone following the link from Google gets an error screen.`
          : `${site} returns a page (HTTP ${status}).`,
        { httpStatus: status, finalUrl: measurement.finalUrl },
      ),
    )

    if (broken) return findings
  }

  /* ---- trust, the half that needed the page ---------------------------- */

  if (measurement.isHttps !== null) {
    findings.push(
      finding(
        'no_https',
        measurement.isHttps,
        measurement.isHttps
          ? 'Served over HTTPS.'
          : 'The site is served over plain http. Chrome puts “Not secure” in the address bar before a visitor has read a word, and a contact form on it is sending names and phone numbers in the clear.',
        { finalUrl: measurement.finalUrl },
      ),
    )
  }

  /* ---- mobile ---------------------------------------------------------- */

  if (measurement.isMobileFriendly !== null) {
    findings.push(
      finding(
        'not_mobile_friendly',
        measurement.isMobileFriendly,
        measurement.isMobileFriendly
          ? 'Declares a responsive viewport.'
          : 'The page declares no mobile viewport, so on a phone it renders at desktop width and the visitor has to pinch and drag to read anything. Most people who look this business up are on a phone.',
      ),
    )
  }

  /* ---- how fast the server itself is ----------------------------------- */

  if (measurement.loadMs !== null && measurement.websiteStatus === 'reachable') {
    const slow = measurement.loadMs > AUDIT_THRESHOLDS.slowResponseMs
    findings.push(
      finding(
        'slow_response',
        !slow,
        slow
          ? `The server took ${seconds(measurement.loadMs)} seconds just to hand over the page — before a single image loaded.`
          : `The server returned the page in ${seconds(measurement.loadMs)} seconds.`,
        { loadMs: measurement.loadMs, thresholdMs: AUDIT_THRESHOLDS.slowResponseMs },
      ),
    )
  }

  /* ---- platform -------------------------------------------------------- */

  if (measurement.platform === 'wordpress' && measurement.platformVersion) {
    const major = Number(measurement.platformVersion.split('.')[0])
    if (Number.isFinite(major)) {
      const outdated = major < AUDIT_THRESHOLDS.wordpressMajorFloor
      findings.push(
        finding(
          'outdated_wordpress',
          !outdated,
          outdated
            ? `Runs WordPress ${measurement.platformVersion}. That release line stopped getting security fixes years ago, and the version number is readable by anyone who views the page source — which is exactly how sites like this get defaced.`
            : `Runs WordPress ${measurement.platformVersion}, a supported release line.`,
          {
            version: measurement.platformVersion,
            major,
            supportedFrom: `${AUDIT_THRESHOLDS.wordpressMajorFloor}.0`,
          },
        ),
      )
    }
  }

  if (measurement.websiteStatus === 'reachable') {
    const vendor = typeof raw.freeSubdomain === 'string' ? raw.freeSubdomain : null
    findings.push(
      finding(
        'free_subdomain',
        vendor === null,
        vendor === null
          ? 'The site is on the business’s own domain.'
          : `The site lives at ${site}, a free ${vendor} subdomain. The business does not own the address it prints on its van, and it cannot take it anywhere.`,
        { vendor, hostname: site },
      ),
    )
  }

  if (measurement.platform) {
    const diy = DIY_PLATFORMS.has(measurement.platform)
    findings.push(
      finding(
        'diy_platform',
        !diy,
        diy
          ? `Built on ${measurement.platform}, a drag-and-drop builder — put together by the owner or a relative rather than commissioned.`
          : `Built on ${measurement.platform}.`,
        { platform: measurement.platform, version: measurement.platformVersion },
      ),
    )
  }

  /* ---- the 2010 tell --------------------------------------------------- */

  if (measurement.websiteStatus === 'reachable') {
    const markers = Array.isArray(raw.datedMarkers) ? (raw.datedMarkers as string[]) : []
    // Two markers, not one: a single stray <center> is sloppiness, but a table
    // layout AND no viewport AND bgcolor attributes is a page from another era.
    const dated = markers.length >= 2
    findings.push(
      finding(
        'dated_markup',
        !dated,
        dated
          ? `The page is still built with ${markers.join(', ')}. Those are the techniques sites were built with around 2010, and it is why it looks the way it does.`
          : 'No pre-responsive markup on the page.',
        { markers, isTableLayout: measurement.isTableLayout },
      ),
    )
  }

  /* ---- maintenance ----------------------------------------------------- */

  if (measurement.copyrightYear !== null) {
    const yearsBehind = now.getFullYear() - measurement.copyrightYear
    const stale = yearsBehind > AUDIT_THRESHOLDS.staleCopyrightYears
    findings.push(
      finding(
        'stale_copyright',
        !stale,
        stale
          ? `The footer still reads © ${measurement.copyrightYear}. Nobody has opened this site in ${yearsBehind} years, and every visitor can see that.`
          : `The footer reads © ${measurement.copyrightYear}.`,
        { copyrightYear: measurement.copyrightYear, yearsBehind },
      ),
    )
  }

  /* ---- how it looks in a search result --------------------------------- */

  if (measurement.hasTitle !== null) {
    findings.push(
      finding(
        'no_title',
        measurement.hasTitle,
        measurement.hasTitle
          ? `The page is titled “${typeof raw.title === 'string' ? raw.title : ''}”.`
          : 'The page has no title tag. The browser tab and every Google result show the bare web address instead of the business name.',
        { title: typeof raw.title === 'string' ? raw.title : null },
      ),
    )
  }

  if (measurement.hasMetaDescription !== null) {
    findings.push(
      finding(
        'no_meta_description',
        measurement.hasMetaDescription,
        measurement.hasMetaDescription
          ? 'The page has a description for search results.'
          : 'No description for search results, so Google writes the snippet under their listing itself — usually whatever stray sentence it finds first on the page.',
      ),
    )
  }

  if (measurement.hasFavicon !== null) {
    findings.push(
      finding(
        'no_favicon',
        measurement.hasFavicon,
        measurement.hasFavicon
          ? 'The site has a favicon.'
          : 'No favicon, so the browser tab and every bookmark show a blank sheet of paper where the logo should be.',
      ),
    )
  }

  return findings
}

/* ------------------------------------------------------------------------- *
 * The PageSpeed stage
 * ------------------------------------------------------------------------- */

/**
 * Diagnose what Google's own test said.
 *
 * The grade is two codes rather than one with a computed severity, because
 * severity is a property of the code everywhere else in this product — see the
 * note at the top of `vocabulary.ts`. Exactly one of them is ever emitted.
 */
export function judgePerformance(psi: PageSpeed): Finding[] {
  if (psi.state !== 'ok') return []

  const findings: Finding[] = []
  const evidence = {
    score: psi.performance,
    lcpMs: psi.lcpMs,
    cls: psi.cls,
    strategy: 'mobile',
    testedUrl: psi.testedUrl,
    testedAt: psi.fetchedAt,
    // The operator can hand this to the owner and let them run it themselves.
    reportUrl: psi.reportUrl,
  }

  if (psi.performance !== null) {
    if (psi.performance < AUDIT_THRESHOLDS.psiPoor) {
      findings.push(
        finding(
          'psi_poor',
          false,
          `Google's own PageSpeed test scores this site ${psi.performance} out of 100 on a phone. Anything under 50 is what Google calls poor; this is less than half of that.`,
          evidence,
        ),
      )
    } else if (psi.performance < AUDIT_THRESHOLDS.psiWeak) {
      findings.push(
        finding(
          'psi_weak',
          false,
          `Google's own PageSpeed test scores this site ${psi.performance} out of 100 on a phone. Google calls anything under 50 poor.`,
          evidence,
        ),
      )
    } else {
      findings.push(
        finding(
          'psi_weak',
          true,
          `Google's PageSpeed test scores this site ${psi.performance} out of 100 on a phone.`,
          evidence,
        ),
      )
    }
  }

  if (psi.lcpMs !== null) {
    const poor = psi.lcpMs > AUDIT_THRESHOLDS.lcpMs
    findings.push(
      finding(
        'poor_lcp',
        !poor,
        poor
          ? `On a phone, the main thing on the page takes ${seconds(psi.lcpMs)} seconds to appear. Google's own threshold for "poor" is 4 seconds — most people have gone back to the search results by then.`
          : `The main content appears in ${seconds(psi.lcpMs)} seconds on a phone.`,
        evidence,
      ),
    )
  }

  if (psi.cls !== null) {
    const poor = psi.cls > AUDIT_THRESHOLDS.cls
    findings.push(
      finding(
        'layout_shift',
        !poor,
        poor
          ? `The page moves around under the reader while it loads — a layout-shift score of ${psi.cls.toFixed(2)}, where Google calls anything above 0.25 poor. It is why people tap the wrong thing.`
          : `The page holds still while it loads (layout shift ${psi.cls.toFixed(2)}).`,
        evidence,
      ),
    )
  }

  return findings
}
