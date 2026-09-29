import Link from 'next/link'

import { IconExternal, IconPulse } from '@/components/icons'
import { CallBriefing } from '@/components/leads/call-briefing'
import { CallHistory } from '@/components/leads/call-history'
import { ChangeMarks } from '@/components/leads/change-marks'
import { LeadActions } from '@/components/leads/lead-actions'
import { PrepareCall } from '@/components/leads/prepare-call'
import { LeadScreenshot } from '@/components/leads/lead-screenshot'
import { LeadTimeline } from '@/components/leads/lead-timeline'
import { ReAudit } from '@/components/leads/re-audit'
import { RefreshLead } from '@/components/leads/refresh-lead'
import { ScoreBreakdown } from '@/components/leads/score-breakdown'
import { SEVERITY_TONE } from '@/components/leads/tone'
import { StatusStrip } from '@/components/shell/status-strip'
import { CHANGE_SPECS, isChangeCode, sortChanges } from '@/lib/leads/changes'
import { FINDING_SPECS, isFindingCode, severityRank } from '@/lib/enrichment/vocabulary'
import { ago, fullDate, dueLabel, shortDate } from '@/lib/leads/dates'
import { formatPlaceType } from '@/lib/places-types'
import type { AuditFinding, LeadAudit, LeadDetail } from '@/lib/leads/types'

/*
 * One lead, and what is wrong with its website.
 *
 * This surface has one job, and PRODUCT.md's fourth principle sets it: a lead
 * read cold two months later must explain itself with no memory of the session
 * that produced it. So the page is not a record card with an audit attached —
 * it is the diagnosis, in the order it would be said out loud, with the
 * evidence for each claim underneath it and the business's own details reduced
 * to the strip needed to dial the number.
 *
 * Faults first and passes second, both of them present. The faults are the
 * pitch. The passes are what stops the pitch being wrong: knowing the site
 * already has a valid certificate is what keeps him from opening a call with
 * something the owner can immediately disprove.
 */

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/* ------------------------------------------------------------------------- *
 * Evidence
 * ------------------------------------------------------------------------- */

/** `expiredMonthsAgo` reads as `expired months ago`. Enough for a caption. */
function humanKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (first) => first.toLowerCase())
    .replace(/\bms\b/i, 'ms')
}

function humanValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return String(value).slice(0, 160)
}

/**
 * The proof under a claim.
 *
 * Rendered generically from whatever the check recorded, rather than through a
 * per-code template. A new criterion should be able to carry new evidence
 * without anybody having to come back here and teach this component about it —
 * and a criterion that recorded nothing shows nothing, which is a visible and
 * useful embarrassment.
 */
function Evidence({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return null

  const report = typeof value.reportUrl === 'string' ? value.reportUrl : null
  const entries = Object.entries(value).filter(
    ([key, entry]) =>
      key !== 'reportUrl' &&
      entry !== null &&
      entry !== undefined &&
      entry !== '' &&
      !(Array.isArray(entry) && entry.length === 0),
  )

  if (!entries.length && !report) return null

  return (
    <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-data text-micro">
      {entries.map(([key, entry]) => (
        <div key={key} className="flex items-baseline gap-1">
          <dt className="text-ink-ghost">{humanKey(key)}</dt>
          <dd className="text-ink-faint">{humanValue(entry)}</dd>
        </div>
      ))}
      {report ? (
        <a
          href={report}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-ink-faint underline decoration-rule-strong underline-offset-2 transition-colors hover:text-signal"
        >
          run it yourself
          <IconExternal className="size-3" />
        </a>
      ) : null}
    </dl>
  )
}

/* ------------------------------------------------------------------------- *
 * The findings
 * ------------------------------------------------------------------------- */

function bySeverity(a: AuditFinding, b: AuditFinding): number {
  const rank = severityRank(a.severity) - severityRank(b.severity)
  return rank !== 0 ? rank : a.code.localeCompare(b.code)
}

function Fault({ finding }: { finding: AuditFinding }) {
  const spec = isFindingCode(finding.code) ? FINDING_SPECS[finding.code] : null

  return (
    <li className="border-b border-rule px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className={`label shrink-0 ${SEVERITY_TONE[finding.severity]}`}>
          {spec?.mark ?? finding.code}
        </span>
        <span className="text-sm font-semibold text-ink">{spec?.label ?? finding.code}</span>
        <span className="ml-auto shrink-0 font-data text-micro text-ink-ghost">
          {finding.category}
        </span>
      </div>
      {/* The sentence he reads aloud. Full ink: this is the content of the page. */}
      <p className="mt-1 max-w-[70ch] text-sm text-ink-dim">{finding.message}</p>
      <Evidence value={finding.value} />
    </li>
  )
}

function Pass({ finding }: { finding: AuditFinding }) {
  const spec = isFindingCode(finding.code) ? FINDING_SPECS[finding.code] : null

  return (
    <li className="flex items-baseline gap-2 px-3 py-1">
      <span className="label shrink-0 text-ink-ghost">{spec?.mark ?? finding.code}</span>
      <span className="truncate text-sm text-ink-faint" title={finding.message}>
        {finding.message}
      </span>
    </li>
  )
}

/* ------------------------------------------------------------------------- *
 * The measurements
 * ------------------------------------------------------------------------- */

function yesNo(value: boolean | null): string | null {
  return value === null ? null : value ? 'yes' : 'no'
}

/**
 * An address to write to, read off the business's own Impressum.
 *
 * Above the notebook rather than in it, because it is the one thing in this
 * column that is acted on rather than checked. Google sells a phone number for
 * nearly every lead and an email address for almost none, so for most of the
 * book this is the only way to make contact that is not a cold call.
 *
 * Amber, not the green reserved for volatile Google data: this was not bought
 * from anybody, it was read off the front of the business's own shop.
 */
function ImprintContact({ lead }: { lead: LeadDetail['lead'] }) {
  if (!lead.imprintEmail && !lead.imprintPhone) return null

  return (
    <>
      <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-ghost">
        Imprint contact
      </h2>
      <dl className="divide-y divide-rule border-b border-rule">
        {lead.imprintEmail ? (
          <div className="flex items-baseline gap-3 px-3 py-1">
            <dt className="label w-32 shrink-0 text-ink-ghost">Email</dt>
            <dd className="min-w-0 truncate font-data text-micro">
              <a
                href={`mailto:${lead.imprintEmail}`}
                className="text-signal transition-colors hover:underline"
                title={lead.imprintEmail}
              >
                {lead.imprintEmail}
              </a>
            </dd>
          </div>
        ) : null}
        {lead.imprintPhone ? (
          <div className="flex items-baseline gap-3 px-3 py-1">
            <dt className="label w-32 shrink-0 text-ink-ghost">Phone</dt>
            <dd className="min-w-0 truncate font-data text-micro text-ink-dim">
              {lead.imprintPhone}
            </dd>
          </div>
        ) : null}
        {lead.imprintFetchedAt ? (
          <div className="flex items-baseline gap-3 px-3 py-1">
            <dt className="label w-32 shrink-0 text-ink-ghost">Read</dt>
            <dd className="min-w-0 truncate font-data text-micro text-ink-faint">
              {shortDate(lead.imprintFetchedAt)}
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  )
}

/**
 * What was observed, as opposed to what was concluded.
 *
 * The same split the schema draws, made visible: this column is the audit's
 * notebook. It is deliberately duller than the diagnosis beside it — it is
 * there to be checked against, not read.
 */
function Measurements({ audit }: { audit: LeadAudit }) {
  const observed: [string, string | null][] = [
    ['Checked', fullDate(audit.auditedAt)],
    ['Checker', audit.checkerVersion],
    ['Took', audit.durationMs === null ? null : seconds(audit.durationMs)],
    ['URL', audit.websiteUrl],
    ['Landed on', audit.finalUrl === audit.websiteUrl ? null : audit.finalUrl],
    ['Outcome', audit.websiteStatus.replace('_', ' ')],
    ['HTTP', audit.httpStatus === null ? null : String(audit.httpStatus)],
    ['Presence', audit.presenceKind],
    ['DNS resolves', yesNo(audit.dnsResolves)],
    ['HTTPS', yesNo(audit.isHttps)],
    ['Certificate', audit.tlsValid === null ? null : audit.tlsValid ? 'valid' : 'invalid'],
    ['Certificate expires', audit.tlsExpiresAt ? shortDate(audit.tlsExpiresAt) : null],
    ['Mobile viewport', yesNo(audit.isMobileFriendly)],
    ['Title', yesNo(audit.hasTitle)],
    ['Meta description', yesNo(audit.hasMetaDescription)],
    ['Favicon', yesNo(audit.hasFavicon)],
    ['Table layout', yesNo(audit.isTableLayout)],
    ['Server response', audit.loadMs === null ? null : seconds(audit.loadMs)],
    ['Footer year', audit.copyrightYear === null ? null : String(audit.copyrightYear)],
    [
      'Platform',
      audit.platform
        ? `${audit.platform}${audit.platformVersion ? ` ${audit.platformVersion}` : ''}`
        : null,
    ],
    ['Impressum', audit.imprintUrl],
    ['Imprint address', yesNo(audit.imprintHasAddress)],
    ['Imprint phone', yesNo(audit.imprintHasPhone)],
    ['Imprint email', yesNo(audit.imprintHasEmail)],
    ['VAT number', yesNo(audit.imprintHasVatId)],
    ['Privacy policy', yesNo(audit.hasPrivacyPolicy)],
    ['Google fonts', yesNo(audit.loadsExternalFonts)],
    ['Maps embedded', yesNo(audit.hasExternalMaps)],
    ['Form unencrypted', yesNo(audit.contactFormInsecure)],
    ['PageSpeed', audit.psiPerformance === null ? null : `${audit.psiPerformance}/100`],
    ['LCP', audit.psiLcpMs === null ? null : seconds(audit.psiLcpMs)],
    ['CLS', audit.psiCls === null ? null : audit.psiCls.toFixed(2)],
  ]

  // A measurement that was never taken shows nothing rather than an em dash:
  // this column is long enough already without a list of things not known.
  const rows = observed.filter((row): row is [string, string] => Boolean(row[1]))

  return (
    <dl className="divide-y divide-rule border-b border-rule">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-3 px-3 py-1">
          <dt className="label w-32 shrink-0 text-ink-ghost">{label}</dt>
          <dd className="min-w-0 truncate font-data text-micro text-ink-dim" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------------- *
 * The page
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * What has changed under him
 * ------------------------------------------------------------------------- */

/**
 * The last thing Google changed its mind about, said in full.
 *
 * Directly under the header, above the diagnosis, because it can invalidate the
 * diagnosis. A lead that has built a website since it was saved is still
 * carrying an audit that says it has none, and the operator has to know that
 * before he reads a word of the fault list — not after, from a mark in a
 * history at the bottom of the page.
 *
 * Sticky rather than dismissable: it shows the LAST change with the date it was
 * found, so it stays true whether that was yesterday or in May, and there is
 * nothing to acknowledge and no state to get wrong.
 */
function Changed({ lead }: { lead: LeadDetail['lead'] }) {
  const codes = sortChanges(lead.changeFlags)
  if (!codes.length) return null

  return (
    /*
      A `live` rule, not the amber one.

      DESIGN.md gives each signal colour exactly one meaning, and amber is the
      operator's own decisions and his book — which is what the actions band
      directly below this one carries. What this band holds is the opposite: it
      is Google's, transient, and arrived without him. `live` is the token for
      exactly that, and using it here also stops three amber-ruled bands from
      stacking down the top of the page with nothing separating them.
    */
    <section
      aria-label="What has changed"
      className="border-b border-rule border-l border-l-live bg-panel px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="label text-ink-dim">
          Changed{lead.changedAt ? ` ${ago(lead.changedAt)}` : ''}
        </h2>
        <ChangeMarks codes={lead.changeFlags} at={lead.changedAt} variant="full" />
      </div>

      <ul className="mt-1 max-w-[70ch]">
        {codes.map((code) => (
          <li key={code} className="text-sm text-ink-dim">
            {CHANGE_SPECS[code].label}.
          </li>
        ))}
      </ul>
    </section>
  )
}

export function LeadDiagnosis({ detail }: { detail: LeadDetail }) {
  const { lead, audit, history, score, movement, timeline, briefing, calls } = detail

  const faults = audit ? audit.findings.filter((entry) => !entry.passed).sort(bySeverity) : []
  const passes = audit ? audit.findings.filter((entry) => entry.passed).sort(bySeverity) : []

  const auditing = lead.enrichmentState === 'queued' || lead.enrichmentState === 'running'
  const profiling = audit?.psiState === 'pending' || audit?.psiState === 'running'

  /*
   * The audit predates the last thing that changed about the site itself.
   *
   * The refresh queues a re-audit the moment it finds this, so the window is
   * usually seconds — but "usually" is not what the operator is holding when he
   * reads a fault list aloud, and an audit that describes a website the business
   * no longer has is the one failure this page must never make quietly.
   */
  const auditIsStale =
    lead.changedAt !== null &&
    lead.changeFlags.some((code) => isChangeCode(code) && CHANGE_SPECS[code].invalidatesAudit) &&
    (lead.lastAuditedAt === null || lead.lastAuditedAt < lead.changedAt)

  return (
    <>
      <StatusStrip provenance="book" detail={`Google data ${shortDate(lead.fetchedAt)}`}>
        <RefreshLead leadId={lead.id} fetchedAt={lead.fetchedAt} />
        <ReAudit leadId={lead.id} pending={auditing || profiling} />
        {/*
          Last on the strip and the only primary control on it. The other two
          maintain the lead; this one is what he presses because he is about to
          ring the number in the header.
        */}
        <PrepareCall leadId={lead.id} prepared={briefing !== null} />
      </StatusStrip>

      <header className="border-b border-rule-strong px-3 py-2.5">
        <Link
          href="/leads"
          className="label text-ink-faint transition-colors hover:text-ink-dim"
        >
          ← Book
        </Link>

        {/*
          `wrap-anywhere` rather than truncation. This is the one place the whole
          name has to be readable — he is about to say it on the phone — and
          German compounds run past any single line at any width worth having.
          `break-words` alone leaves a 40-character unhyphenated compound
          overflowing; this breaks inside the word when there is no other option.
        */}
        <h1 className="mt-1 text-lg font-semibold wrap-anywhere text-ink">{lead.name}</h1>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-data text-micro text-ink-faint">
          <span className="label text-ink-dim">{lead.status}</span>
          {lead.formattedAddress ? <span>{lead.formattedAddress}</span> : null}
          {lead.phone ? <a href={`tel:${lead.phone}`} className="text-ink-dim">{lead.phone}</a> : null}
          {lead.website ? (
            <a
              href={lead.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline decoration-rule-strong underline-offset-2 transition-colors hover:text-signal"
            >
              {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              <IconExternal className="size-3" />
            </a>
          ) : (
            <span className="label text-ink">No site</span>
          )}
          {lead.primaryType ? <span>{formatPlaceType(lead.primaryType)}</span> : null}
          <span>saved {shortDate(lead.savedAt)}</span>
          {/* His own decision coming back at him, so it is amber, not a fault. */}
          {lead.followUpAt ? (
            <span className="text-signal">
              follow up {shortDate(lead.followUpAt)} · {dueLabel(lead.followUpAt)}
            </span>
          ) : null}
        </div>
      </header>

      <Changed lead={lead} />

      {/*
        Google refused, and the header above is therefore older than its date
        implies. Said on the lead rather than only in a log, because the number
        he is about to dial is one of the fields that did not get refreshed.
      */}
      {lead.refreshError ? (
        <p className="border-b border-rule px-3 py-2 text-sm text-ink-faint">
          The last refresh could not reach Google. {lead.refreshError} The details above are
          still from {shortDate(lead.fetchedAt)}.
        </p>
      ) : null}

      <LeadActions lead={lead} />

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="min-w-0">
          {/*
            Above the diagnosis, because it is the answer and the diagnosis is
            the argument for it. Rendered only once something has prepared one:
            the control that does so is on the strip above, and a permanent
            empty block on every lead in the book would be a line to read past a
            thousand times to be useful forty.
          */}
          {briefing ? <CallBriefing briefing={briefing} /> : null}

          {!audit ? (
            <div className="px-3 py-6">
              <p className="text-sm text-ink-dim">
                {auditing
                  ? 'The audit is running. This page fills in as it lands.'
                  : lead.enrichmentState === 'failed'
                    ? `The audit could not be run. ${lead.enrichmentError ?? ''}`
                    : 'This lead has never been audited. Run one and it will have a diagnosis in a few seconds.'}
              </p>
            </div>
          ) : (
            <>
              <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-dim">
                {faults.length
                  ? `Diagnosis — ${faults.length} ${faults.length === 1 ? 'fault' : 'faults'}`
                  : 'Diagnosis'}
              </h2>

              {/*
                The one thing this page must never do quietly: present a fault
                list about a website the business no longer has, or no longer
                has in that form. The refresh re-queues the audit the moment it
                finds this, so the window is short — but he could be reading
                this out loud inside it.
              */}
              {auditIsStale ? (
                <p className="border-b border-rule border-l border-l-signal bg-panel px-3 py-2 text-sm text-ink">
                  This audit is older than the change above — it was run on{' '}
                  {shortDate(audit.auditedAt)} and describes the site as it was then.
                  {auditing ? ' A new one is running.' : ' Re-audit before using it.'}
                </p>
              ) : null}

              {faults.length ? (
                <ul>
                  {faults.map((entry) => (
                    <Fault key={entry.code} finding={entry} />
                  ))}
                </ul>
              ) : (
                <p className="border-b border-rule px-3 py-4 text-sm text-ink-dim">
                  Nothing to sell against. Every check this audit can make, this site passed.
                </p>
              )}

              {/*
                PageSpeed lands a stage later than everything above. Saying so
                is the difference between "still measuring" and "measured and
                fine", and the operator is about to phone someone about it.
              */}
              {profiling ? (
                <p className="label flex items-center gap-1.5 border-b border-rule px-3 py-2 text-ink-faint">
                  <IconPulse className="size-3.5 animate-pulse" />
                  Waiting on Google PageSpeed
                </p>
              ) : audit.psiState === 'failed' ? (
                <p className="border-b border-rule px-3 py-2 text-sm text-ink-faint">
                  PageSpeed could not score this site. {audit.psiError}
                </p>
              ) : null}

              {passes.length ? (
                <>
                  <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-ghost">
                    Passed — do not claim these are wrong
                  </h2>
                  <ul className="divide-y divide-rule border-b border-rule">
                    {passes.map((entry) => (
                      <Pass key={entry.code} finding={entry} />
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}

          {/*
            The calls sit directly above the timeline, and the two are one thing
            read in one place: what has happened with this business. Calls first
            because they are the coarser record — five attempts and two
            conversations — and the timeline underneath is what he wrote while
            they were going on.

            In the wide half for the same reason the timeline is: the right
            column is the audit's notebook, measurements and past runs, and a
            summary is prose rather than a measurement.
          */}
          <CallHistory entries={calls} />

          {/*
            The history sits under the diagnosis rather than in the column to
            the right, and in the wide half rather than the narrow one, because
            it is prose he wrote. The right column is the audit's notebook —
            measurements and past runs — and his own account of the lead is not
            a measurement.
          */}
          <LeadTimeline entries={timeline} />
        </section>

        <aside className="min-w-0 border-t border-rule lg:border-l lg:border-t-0">
          {/*
            The score sits above the measurements, at the top of the column the
            eye lands in after the diagnosis. It is the answer to "is this worth
            a call", and the faults to its left are the argument for it — so the
            two read as one thing, and neither is buried under the notebook.
          */}
          <ScoreBreakdown score={score} movement={movement} />

          {/*
            Directly under the score and above the notebook. The score answers
            "is this worth a call"; this answers "what do I open with", and both
            of those are read before the measurement list ever is. It renders
            nothing when the audit has no screenshot, which is most audits — a
            business with no website has no phone view to photograph.
          */}
          {audit ? <LeadScreenshot audit={audit} stale={auditIsStale} /> : null}

          {/*
            Then who to write to. Below the screenshot because that one is read
            at a glance and this one is acted on — and above the notebook for
            the same reason the screenshot is: it is a thing to do, not a thing
            to check against.
          */}
          <ImprintContact lead={lead} />

          {audit ? (
            <>
              <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-ghost">
                Measured
              </h2>
              <Measurements audit={audit} />
            </>
          ) : null}

          {history.length ? (
            <>
              <h2 className="label border-b border-rule bg-panel px-3 py-1.5 text-ink-ghost">
                Earlier audits
              </h2>
              <ul className="divide-y divide-rule border-b border-rule">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-3 px-3 py-1">
                    <span className="font-data text-micro text-ink-faint">
                      {shortDate(entry.auditedAt)}
                    </span>
                    <span className="label text-ink-ghost">
                      {entry.websiteStatus.replace('_', ' ')}
                    </span>
                    <span className="ml-auto shrink-0 font-data text-micro text-ink-faint">
                      {entry.failedCodes.length} fault
                      {entry.failedCodes.length === 1 ? '' : 's'}
                      {entry.psiPerformance === null ? '' : ` · PS ${entry.psiPerformance}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </>
  )
}
