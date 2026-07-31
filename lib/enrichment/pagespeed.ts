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
 *
 * THE RATE LIMIT IS A "NOT NOW", AND THE DIFFERENCE MATTERS. A bulk re-audit is
 * exactly the traffic shape that trips the free tier: forty leads queued at once
 * means forty PageSpeed calls in a few minutes, and Google starts refusing part
 * way through. Recording those refusals as `failed` would permanently mark a
 * batch of perfectly good sites unscoreable because of a limit that lifted a
 * minute later — and the score queue skips a lead whose PageSpeed never
 * settled, so those leads would sit unranked for ever with nothing saying why.
 *
 * So a refusal that will pass is flagged as such here and turned into a retry by
 * the store, and a refusal that will not — a page Lighthouse cannot load — is a
 * real failure and stays one.
 */

/** Generous, because the API genuinely is this slow, and finite because we die at 60s. */
const TIMEOUT_MS = 35_000

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export interface PageSpeed {
  state: 'ok' | 'failed' | 'skipped'
  /**
   * True when the failure was Google declining to answer right now rather than
   * anything about the site: a rate limit, a 5xx, or a timeout. The caller puts
   * the job back rather than writing the failure down for good.
   */
  retryable: boolean
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
  /**
   * The last frame Lighthouse rendered, as a `data:image/jpeg;base64,...` URI.
   *
   * ALREADY PAID FOR. Lighthouse has to render the page on a simulated phone to
   * produce the numbers above, and it returns the frame it ended on in the same
   * response under `audits['final-screenshot']`. That audit sits in the
   * performance category with weight 0 and group 'hidden', so the request this
   * module already makes — `category=performance`, `strategy=mobile` — receives
   * it without asking for anything more. There is no second call, no headless
   * browser and no extra quota behind this field.
   *
   * It is deliberately NOT stored on the audit row. The caller writes the bytes
   * to Storage and keeps a path; see lib/enrichment/screenshot.ts.
   *
   * Null is ordinary: Lighthouse omits it in timespan mode and can fail to
   * produce a frame at all. A missing picture is not a failed measurement.
   */
  screenshot: string | null
}

function skipped(reason: string): PageSpeed {
  return {
    state: 'skipped',
    retryable: false,
    performance: null,
    lcpMs: null,
    cls: null,
    error: reason,
    testedUrl: null,
    fetchedAt: new Date().toISOString(),
    reportUrl: null,
    screenshot: null,
  }
}

function failed(url: string, reason: string, retryable = false): PageSpeed {
  return {
    state: 'failed',
    retryable,
    performance: null,
    lcpMs: null,
    cls: null,
    error: reason.slice(0, 400),
    testedUrl: url,
    fetchedAt: new Date().toISOString(),
    reportUrl: reportUrl(url),
    screenshot: null,
  }
}

function reportUrl(url: string): string {
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=mobile`
}

/**
 * Is a key configured?
 *
 * Read by the pass to size its own concurrency. Without a key the quota is
 * per-IP and shared with everything else on the host, which on a serverless
 * platform means everything else on that machine — four calls at once is a way
 * to be rate-limited on purpose. With one it is 25,000 a day and ours alone.
 */
export function hasPageSpeedKey(): boolean {
  return Boolean(process.env.GOOGLE_PAGESPEED_API_KEY)
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
 * Past this, the response is not a phone screenshot and we do not want it in
 * memory or in Storage.
 *
 * A 412x823 JPEG is 30-120 KB, and base64 adds a third. Three megabytes is
 * therefore about twenty times the largest plausible frame — wide enough that it
 * will never reject a real screenshot, narrow enough that a malformed or hostile
 * response cannot make a serverless function hold a hundred megabytes while it
 * decodes something that was never an image.
 */
const MAX_SCREENSHOT_CHARS = 3_000_000

/**
 * The frame Lighthouse ended on.
 *
 * Read defensively rather than trustingly, because this is the one field on the
 * response we take on faith about its shape: the numbers above are validated by
 * being numbers, and a data URI is a string that could be anything. Anything
 * that is not a plausible image data URI becomes null, which the rest of the
 * pipeline already treats as the ordinary case.
 */
function finalScreenshot(audits: Record<string, unknown> | undefined): string | null {
  const details = (
    audits?.['final-screenshot'] as { details?: { data?: unknown } } | undefined
  )?.details
  const data = details?.data

  if (typeof data !== 'string') return null
  if (!data.startsWith('data:image/')) return null
  if (data.length > MAX_SCREENSHOT_CHARS) return null
  return data
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
        return failed(url, 'PageSpeed is rate-limiting us. Waiting and trying again.', true)
      }
      /*
       * A 5xx is Google having a bad minute, not a verdict on the site. Treated
       * as retryable for the same reason the 429 is: the alternative is a batch
       * of leads permanently unscoreable because of an outage.
       */
      if (response.status >= 500) {
        return failed(url, `PageSpeed answered ${response.status}. Trying again later.`, true)
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
      retryable: false,
      performance: toHundred(lighthouse?.categories?.performance?.score),
      lcpMs: lcp === null ? null : Math.round(lcp),
      cls: numericValue(lighthouse?.audits, 'cumulative-layout-shift'),
      error: null,
      testedUrl: lighthouse?.finalUrl ?? url,
      fetchedAt: new Date().toISOString(),
      reportUrl: reportUrl(url),
      screenshot: finalScreenshot(lighthouse?.audits),
    }
  } catch (error) {
    // A timeout or a transport failure says nothing about the site either.
    const aborted = error instanceof Error && error.name === 'AbortError'
    return failed(
      url,
      aborted
        ? `PageSpeed did not answer within ${TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : 'PageSpeed could not be reached.',
      true,
    )
  } finally {
    clearTimeout(timer)
  }
}
