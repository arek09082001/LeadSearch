/*
 * The audit's vocabulary: what can be found, how bad it is, what to call it.
 *
 * Not `server-only`. The pass writes findings from this and the table renders
 * marks from it, and there must not be two lists — a row that says "No HTTPS"
 * and a finding row that says something else about the same code would be a
 * correctness bug wearing a styling bug's clothes.
 *
 * SEVERITY IS A PROPERTY OF THE CODE, not of the run. Two consequences worth
 * stating, because they shaped the list below:
 *
 *   - A check with degrees becomes two codes rather than one code with a
 *     computed severity. `psi_poor` and `psi_weak` are separate entries for
 *     that reason, and each is a thing the operator can filter on by name.
 *   - The severity is still written onto every finding row. That is not
 *     redundancy: it is what keeps a two-year-old audit explainable after this
 *     file has been argued with, the same job `checker_version` does.
 *
 * What the three levels mean, so the list can be extended consistently:
 *
 *   critical — the business is effectively absent, unreachable or untrusted
 *              online. One sentence on the phone and the owner recognises it.
 *   warning  — a real defect that can be demonstrated on the call, but the
 *              site still works.
 *   info     — context that colours the pitch and does not sell it.
 */

export type FindingSeverity = 'critical' | 'warning' | 'info'

export type FindingCategory =
  | 'presence'
  | 'availability'
  | 'trust'
  | 'compliance'
  | 'mobile'
  | 'performance'
  | 'platform'
  | 'maintenance'
  | 'seo'

export const FINDING_CODES = [
  'no_website',
  'social_only',
  'dead_domain',
  'site_unreachable',
  'http_error',
  'no_https',
  'invalid_certificate',
  'no_imprint',
  'imprint_incomplete',
  'no_privacy_policy',
  'insecure_contact_form',
  'external_fonts_cdn',
  'embedded_maps_no_consent',
  'no_vat_id',
  'not_mobile_friendly',
  'psi_poor',
  'psi_weak',
  'poor_lcp',
  'layout_shift',
  'slow_response',
  'outdated_wordpress',
  'free_subdomain',
  'diy_platform',
  'dated_markup',
  'stale_copyright',
  'no_title',
  'no_meta_description',
  'no_favicon',
] as const

export type FindingCode = (typeof FINDING_CODES)[number]

export interface FindingSpec {
  category: FindingCategory
  severity: FindingSeverity
  /** Two or three words. What a table row has space for. */
  mark: string
  /** The full name of the fault, for the diagnosis. */
  label: string
}

export const FINDING_SPECS: Record<FindingCode, FindingSpec> = {
  no_website: {
    category: 'presence',
    severity: 'critical',
    mark: 'No site',
    label: 'No website at all',
  },
  social_only: {
    category: 'presence',
    severity: 'critical',
    mark: 'Social only',
    label: 'A social profile instead of a website',
  },
  dead_domain: {
    category: 'availability',
    severity: 'critical',
    mark: 'Domain dead',
    label: 'The domain no longer resolves',
  },
  site_unreachable: {
    category: 'availability',
    severity: 'critical',
    mark: 'Unreachable',
    label: 'The site did not answer',
  },
  http_error: {
    category: 'availability',
    severity: 'critical',
    mark: 'Server error',
    label: 'The server returns an error instead of a page',
  },
  no_https: {
    category: 'trust',
    severity: 'critical',
    mark: 'No HTTPS',
    label: 'Served without encryption',
  },
  invalid_certificate: {
    category: 'trust',
    severity: 'critical',
    mark: 'Bad certificate',
    label: 'The security certificate does not verify',
  },
  no_imprint: {
    category: 'compliance',
    severity: 'critical',
    mark: 'No imprint',
    label: 'No Impressum',
  },
  imprint_incomplete: {
    category: 'compliance',
    severity: 'critical',
    mark: 'Thin imprint',
    label: 'The Impressum does not name what it has to',
  },
  no_privacy_policy: {
    category: 'compliance',
    severity: 'critical',
    mark: 'No privacy',
    label: 'No privacy policy is linked',
  },
  insecure_contact_form: {
    // Trust rather than compliance: this one is about what the visitor's
    // browser tells them, not about what the page fails to say.
    category: 'trust',
    severity: 'warning',
    mark: 'Open form',
    label: 'A contact form on an unencrypted page',
  },
  external_fonts_cdn: {
    category: 'compliance',
    severity: 'warning',
    mark: 'Google fonts',
    label: 'Fonts loaded from Google’s servers',
  },
  embedded_maps_no_consent: {
    category: 'compliance',
    severity: 'warning',
    mark: 'Maps embed',
    label: 'A Google Maps frame loads unasked',
  },
  no_vat_id: {
    category: 'compliance',
    severity: 'info',
    mark: 'No VAT ID',
    label: 'No VAT number in the Impressum',
  },
  not_mobile_friendly: {
    category: 'mobile',
    severity: 'critical',
    mark: 'Not mobile',
    label: 'Not built for phones',
  },
  psi_poor: {
    category: 'performance',
    severity: 'critical',
    mark: 'Very slow',
    label: 'Fails Google’s mobile performance test',
  },
  psi_weak: {
    category: 'performance',
    severity: 'warning',
    mark: 'Slow',
    label: 'Scores poorly on Google’s mobile performance test',
  },
  poor_lcp: {
    category: 'performance',
    severity: 'warning',
    mark: 'Slow to paint',
    label: 'The main content takes too long to appear',
  },
  layout_shift: {
    category: 'performance',
    severity: 'warning',
    mark: 'Jumps',
    label: 'The page moves under the reader while it loads',
  },
  slow_response: {
    category: 'performance',
    severity: 'warning',
    mark: 'Slow server',
    label: 'The server is slow to hand over the page',
  },
  outdated_wordpress: {
    category: 'platform',
    severity: 'warning',
    mark: 'Old WordPress',
    label: 'Runs an unsupported WordPress',
  },
  free_subdomain: {
    category: 'platform',
    severity: 'warning',
    mark: 'Free subdomain',
    label: 'No domain of its own',
  },
  diy_platform: {
    category: 'platform',
    severity: 'info',
    mark: 'Builder',
    label: 'Built on a drag-and-drop builder',
  },
  dated_markup: {
    category: 'platform',
    severity: 'warning',
    mark: 'Dated build',
    label: 'Built with techniques abandoned around 2010',
  },
  stale_copyright: {
    category: 'maintenance',
    severity: 'warning',
    mark: 'Stale ©',
    label: 'Nobody has updated the site in years',
  },
  no_title: {
    category: 'seo',
    severity: 'warning',
    mark: 'No title',
    label: 'The page has no title',
  },
  no_meta_description: {
    category: 'seo',
    severity: 'warning',
    mark: 'No meta',
    label: 'No description for search results',
  },
  no_favicon: {
    category: 'seo',
    severity: 'info',
    mark: 'No icon',
    label: 'No favicon',
  },
}

/**
 * Where each threshold came from.
 *
 * The performance numbers are Google's own published "poor" boundaries for the
 * Core Web Vitals, which is the entire reason to use them: on a call they are
 * not this tool's opinion about a site, they are Google's, and the owner can go
 * and check.
 *
 * The rest are the operator's, and each is one number in one place so that
 * changing his mind is a one-line edit rather than an archaeology exercise.
 */
export const AUDIT_THRESHOLDS = {
  /** Time to first byte and body, measured by the checker itself. */
  slowResponseMs: 3000,
  /** A footer year this far behind is the abandonment tell. */
  staleCopyrightYears: 2,
  /** PageSpeed mobile performance, 0–100. Google calls under 50 "poor". */
  psiPoor: 25,
  psiWeak: 50,
  /** Largest Contentful Paint. Google's "poor" boundary is 4s. */
  lcpMs: 4000,
  /** Cumulative Layout Shift. Google's "poor" boundary is 0.25. */
  cls: 0.25,
  /**
   * WordPress majors below this are unsupported.
   *
   * Deliberately a floor rather than "the newest release": tracking the current
   * version would mean this file quietly becoming wrong between deploys, and a
   * finding that says "at least this old" stays true forever.
   */
  wordpressMajorFloor: 6,
} as const

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 }

/** Sorts critical first. Matches the enum's declared order in Postgres. */
export function severityRank(severity: FindingSeverity): number {
  return SEVERITY_RANK[severity]
}

export function isFindingCode(value: string): value is FindingCode {
  return value in FINDING_SPECS
}

/** Order a set of codes worst-first, then alphabetically for stability. */
export function sortCodes(codes: readonly string[]): FindingCode[] {
  return codes.filter(isFindingCode).sort((a, b) => {
    const bySeverity = severityRank(FINDING_SPECS[a].severity) - severityRank(FINDING_SPECS[b].severity)
    return bySeverity !== 0 ? bySeverity : a.localeCompare(b)
  })
}
