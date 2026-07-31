import { IconExternal } from '@/components/icons'
import { ago, shortDate } from '@/lib/leads/dates'
import type { LeadAudit } from '@/lib/leads/types'

/*
 * What the site looks like on a phone.
 *
 * This is the cheapest sentence on the page and the most expensive to argue
 * with. The fault list says the site has no viewport tag and scores 23; this
 * says what that means to somebody standing outside the shop with a phone. The
 * operator opens the lead, looks once, and knows why he is calling.
 *
 * It costs nothing. Lighthouse has to render the page on a simulated phone to
 * produce the PageSpeed numbers the audit already collects, and it hands back
 * the frame it ended on in the same response. There is no browser here, no
 * screenshot service and no second request — see lib/enrichment/pagespeed.ts.
 *
 * IT IS EVIDENCE, NOT AN IMAGE. So it is small, it is ruled rather than framed,
 * it carries no accent colour, and it states its own age in the same breath as
 * itself. A screenshot from March rendered clean and undated is exactly the
 * quiet untruth this product exists not to tell — the operator would read it
 * aloud on a call and be wrong with total confidence.
 */

/**
 * Lighthouse's mobile emulation, in CSS pixels.
 *
 * Hard-coded because it is the frame's real shape, not a layout preference: the
 * box has to match what Google rendered or the thumbnail letterboxes a phone
 * screenshot into something that is not a phone.
 */
const MOBILE_ASPECT = '412/823'

export function LeadScreenshot({
  audit,
  /** The audit is older than something that changed about the site since. */
  stale,
}: {
  audit: LeadAudit
  stale: boolean
}) {
  if (!audit.screenshotPath) return null

  /*
   * The PageSpeed run's own clock, not the audit's. The two are usually seconds
   * apart, but they are different events — the front-door checks finish in a
   * second and the picture arrives a stage later — and the picture is entitled
   * to be dated by the thing that took it.
   */
  const takenAt = audit.psiCheckedAt ?? audit.auditedAt
  const href = `/api/audits/${audit.id}/screenshot`

  return (
    <section aria-label="Mobile screenshot">
      <h2 className="label flex items-baseline gap-2 border-b border-rule bg-panel px-3 py-1.5 text-ink-ghost">
        On a phone
        {/*
          The age sits in the heading rather than under the picture, so it is
          read on the way in. Both forms: the date is what he repeats on a call,
          the relative age is what tells him whether to trust it.
        */}
        <span className="ml-auto font-data text-micro normal-case tracking-normal text-ink-faint">
          {shortDate(takenAt)} · {ago(takenAt)}
        </span>
      </h2>

      <div className="border-b border-rule px-3 py-2">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex flex-col gap-1"
        >
          {/*
            A plain <img>, deliberately. next/image would route these bytes
            through the optimizer, which fetches and caches them server-side —
            wrong for a private, per-session resource behind a URL that expires
            in a minute, and pointless for a 112px thumbnail of a JPEG Google
            already compressed.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={href}
            alt={`The site as Google rendered it on a phone on ${shortDate(takenAt)}`}
            width={412}
            height={823}
            loading="lazy"
            /*
              `object-top` because the fold is the argument. A phone screenshot
              scaled to fit would shrink the text to nothing; this shows the top
              of the page at a readable scale and lets the click show the rest.
            */
            className="w-28 border border-rule-strong bg-ground object-cover object-top transition-colors group-hover:border-signal"
            style={{ aspectRatio: MOBILE_ASPECT }}
          />

          <span className="inline-flex items-center gap-1 font-data text-micro text-ink-faint transition-colors group-hover:text-signal">
            full size
            <IconExternal className="size-3" />
          </span>
        </a>

        {/*
          Said again, here, even though the page already carries a stale banner
          above the diagnosis. The banner is prose at the top of a long column;
          this is the one element on the page that a person believes on sight,
          and the right column can be read without the left one ever being
          scrolled to.
        */}
        {stale ? (
          <p className="mt-1.5 max-w-[34ch] border-l border-l-signal pl-2 text-sm text-ink">
            The site has changed since this was taken. Do not describe it from this picture.
          </p>
        ) : null}
      </div>
    </section>
  )
}
