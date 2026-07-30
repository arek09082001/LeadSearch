import 'server-only'

/*
 * PageSpeed Insights — Google grading the site, so the operator does not have to.
 *
 * This is the one number in the audit that a business owner cannot argue with,
 * which is the whole reason it is worth the trouble of a second stage: "your
 * site scores 23 out of 100 on Google's own test, here is the link, run it
 * yourself" ends a conversation that "your site is slow" starts.
 *
 * Two things about it shaped the design of the pass around it:
 *
 *   - It is slow. A single call routinely takes twenty seconds and sometimes
 *     forty, because Google is really loading the page on a throttled phone.
 *     That is why it does not run inline with the fast checks — see run.ts.
 *   - It is free, and the free tier is rate-limited per key (or per IP with no
 *     key). A 429 is therefore an ordinary outcome, not an incident, and is
 *     recorded on the audit rather than raised.
 */

/** Generous, because the API genuinely is this slow, and finite because we die at 60s. */
const TIMEOUT_MS = 35_000

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export interface PageSpeed {
  state: 'ok' | 'failed' | 'skipped'
  /** Lighthouse performance category, 0–100 on the mobile strategy. */
  performance: number | null
  /** Largest Contentful Paint, in milliseconds. */
  lcpMs: number | null
  /** Cumulative Layout Shift, unitless. */
  cls: number | null
  error: string | null
  testedUrl: string | null
  fetchedAt: string
  /**
   * The public report, so the finding can carry a link the business owner can
   * open himself. That is what turns a number into proof.
   */
  reportUrl: string | null
}

function skipped(reason: string): PageSpeed {
  return {
    state: 'skipped',
    performance: null,
    lcpMs: null,
    cls: null,
    error: reason,
    testedUrl: null,
    fetchedAt: new Date().toISOString(),
    reportUrl: null,
  }
}

function failed(url: string, reason: string): PageSpeed {
  return {
    state: 'failed',
    performance: null,
    lcpMs: null,
    cls: null,
    error: reason.slice(0, 400),
    testedUrl: url,
    fetchedAt: new Date().toISOString(),
    reportUrl: reportUrl(url),
  }
}

function reportUrl(url: string): string {
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=mobile`
}

/** Lighthouse hands back a 0–1 score; everyone including Google talks in 0–100. */
function toHundred(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

function numericValue(audits: Record<string, unknown> | undefined, id: string): number | null {
  const audit = audits?.[id] as { numericValue?: unknown } | undefined
  const value = audit?.numericValue
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Ask Google how the site performs on a phone.
 *
 * Never throws. Every failure is a recorded state on the audit: a rate limit,
 * a site Lighthouse could not load, or a timeout are all things the operator
 * should be able to see next to the lead rather than things that should stop a
 * background pass.
 */
export async function measurePageSpeed(url: string): Promise<PageSpeed> {
  if (!url) return skipped('There is no URL to test.')

  const request = new URL(ENDPOINT)
  request.searchParams.set('url', url)
  request.searchParams.set('strategy', 'mobile')
  request.searchParams.set('category', 'performance')
  /*
   * Optional, and read here rather than through lib/env.ts because that module
   * is for variables the app cannot start without. Missing this one costs a
   * tighter per-IP quota, not a broken deploy, and the audit says so when it
   * runs out — which is more use than refusing to boot.
   */
  const key = process.env.GOOGLE_PAGESPEED_API_KEY
  if (key) request.searchParams.set('key', key)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(request, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      const detail = ((await response.json().catch(() => null)) as {
        error?: { message?: string }
      } | null)?.error?.message

      if (response.status === 429) {
        return failed(url, 'PageSpeed is rate-limiting us. Re-run the audit later.')
      }
      return failed(url, detail ?? `PageSpeed answered ${response.status}.`)
    }

    const body = (await response.json()) as {
      lighthouseResult?: {
        finalUrl?: string
        categories?: { performance?: { score?: unknown } }
        audits?: Record<string, unknown>
        runtimeError?: { message?: string }
      }
    }

    const lighthouse = body.lighthouseResult
    if (lighthouse?.runtimeError?.message) {
      // Lighthouse reached the site and could not profile it — usually a
      // redirect loop or a page that never finished loading. That is a fact
      // about the site, but not one this column can express, so it is an error.
      return failed(url, lighthouse.runtimeError.message)
    }

    const lcp = numericValue(lighthouse?.audits, 'largest-contentful-paint')

    return {
      state: 'ok',
      performance: toHundred(lighthouse?.categories?.performance?.score),
      lcpMs: lcp === null ? null : Math.round(lcp),
      cls: numericValue(lighthouse?.audits, 'cumulative-layout-shift'),
      error: null,
      testedUrl: lighthouse?.finalUrl ?? url,
      fetchedAt: new Date().toISOString(),
      reportUrl: reportUrl(url),
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return failed(
      url,
      aborted
        ? `PageSpeed did not answer within ${TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : 'PageSpeed could not be reached.',
    )
  } finally {
    clearTimeout(timer)
  }
}
