import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CallAssistant } from '@/components/calls/call-assistant'
import { CallBriefing } from '@/components/leads/call-briefing'
import {
  readCall,
  readCallCost,
  readLatestBriefing,
  readLatestSummary,
  readSegments,
  readTips,
} from '@/lib/assistant/store'
import { readLead } from '@/lib/leads/repository'

/*
 * The assistant view: one call, while it is happening.
 *
 * A server component that reads four rows and hands them to one client
 * component, which is the split every page here draws — but it matters more on
 * this one. What is on this screen when it first paints is what the operator has
 * if the network goes down the second after: the briefing, the number, and
 * whatever transcript already exists.
 *
 * WHICH IS WHY THE SEGMENTS ARE READ ON THE SERVER. Reloading mid-call is a
 * thing that happens — a stray Ctrl-R, a crashed tab, a laptop that slept — and
 * a page that came back empty would look exactly like a page that had lost the
 * conversation. It comes back with everything already written down, and Start
 * resumes against the same timeline rather than resetting it; `markListening`
 * refuses to move the zero once segments exist, which is what makes that safe.
 *
 * `force-dynamic` for the reason the lead page has it: this is a live row and
 * caching it would show a call that has since been closed as still open.
 */

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const call = await readCall(id)
  const lead = call ? await readLead(call.leadId) : null
  return { title: lead ? `Call — ${lead.name}` : 'Call — Lead Engine' }
}

export default async function CallPage({ params }: Props) {
  const { id } = await params

  const call = await readCall(id)
  if (!call) notFound()

  const lead = await readLead(call.leadId)
  // The call outlives nothing: `calls.lead_id` cascades, so a call whose lead is
  // gone is a row that should not exist rather than a page to render around.
  if (!lead) notFound()

  /*
   * The tips come back with the transcript, and for the same reason.
   *
   * A trigger fires once per call, and "once" has to survive a reload — a
   * stray Ctrl-R at minute six would otherwise re-open the page ready to say
   * everything it has already said. Only the trigger and its timestamp are
   * needed for that, which is all `ShownTip` is.
   */
  /*
   * The summary comes back too, for the same reason the tips do.
   *
   * A summary already written is a summary that must not be written again by a
   * reload — `call_summaries` allows several rows per call, so a page that
   * generated on mount would quietly accumulate paragraphs about one
   * conversation, each with `accepted` null. Read here, the surface opens on
   * what is already there and only the Stop button produces a new one.
   */
  /*
   * The cost comes back with the rest of it, and it is a read rather than a
   * running total for the reason `readCallCost` gives: `api_usage` is the only
   * source of truth for spend, and it is already open.
   */
  const [briefing, segments, tips, summary, cost] = await Promise.all([
    readLatestBriefing(call.id, lead.lastAuditedAt),
    readSegments(call.id),
    readTips(call.id),
    readLatestSummary(call.id),
    readCallCost(call.id),
  ])

  return (
    <CallAssistant
      callId={call.id}
      leadId={lead.id}
      leadName={lead.name}
      leadPhone={lead.phone ?? lead.imprintPhone}
      leadCity={lead.city}
      consentNoted={call.consentNoted}
      closed={call.endedAt !== null}
      initialSegments={segments}
      initialTips={tips.map((tip) => ({ trigger: tip.trigger, atMs: tip.atMs }))}
      initialSummary={summary}
      initialOutcome={call.outcome}
      costUsd={cost.billedUsd}
      /*
       * The briefing twice: once as data for the rules, once as markup for the
       * eye. See `CallAssistantProps.prepared` for why neither can stand in for
       * the other.
       */
      prepared={briefing?.briefing ?? null}
      /*
       * Rendered here and passed through as a node. `CallBriefing` is a server
       * component and the surface around it is a client one — so it is composed
       * rather than imported across the boundary, which also means the briefing
       * on this page is the same component the lead page renders rather than a
       * second copy that will drift from it.
       */
      briefing={briefing ? <CallBriefing briefing={briefing} /> : null}
    />
  )
}
