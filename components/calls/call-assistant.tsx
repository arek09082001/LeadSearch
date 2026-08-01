'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'

import { CommandButton, CommandLink } from '@/components/ui/command-button'
import { CallSummaryPanel } from '@/components/calls/call-summary'
import { useCallSummary } from '@/components/calls/use-call-summary'
import { useCallTranscript } from '@/components/calls/use-call-transcript'
import { useLiveTips, type ShownLiveTip } from '@/components/calls/use-live-tips'
import type { Briefing, ShownTip, StoredSummary, TranscriptSegment } from '@/lib/assistant/types'
import { TIP_SPECS } from '@/lib/assistant/vocabulary'

/*
 * The surface that is read with a phone against an ear.
 *
 * Everything about it follows from that one fact. Three columns, fixed, each
 * scrolling on its own: what he prepared, what is being said, and what the
 * assistant will eventually have to add. No tabs — a tab is a thing you have to
 * decide to click, and mid-sentence he will not. Nothing animates and nothing
 * pulses, because motion in the corner of the eye is the one thing guaranteed to
 * pull attention off the conversation.
 *
 * THE ACCENT ON THIS SURFACE IS THE CONTROL. DESIGN.md allows amber one meaning
 * per surface and here it is the Start/Stop button — the only thing on the page
 * he presses, and the thing he has to find without looking for it. The briefing
 * panel in the left column carries its own amber opening line, and that is not a
 * second meaning: it arrives whole from the lead page, inside its own border,
 * quoted rather than restyled. The brief says the briefing appears unchanged and
 * a surface that repainted it to protect a rule would be following the letter of
 * DESIGN.md by breaking what it is for.
 *
 * GREEN IS EVERY TRANSIENT THING and nothing else: the listening dot, the clock,
 * and the interim line the recogniser has not committed to. That is exactly the
 * meaning DESIGN.md gives it — data that expires — and the transcript is the most
 * literally expiring data in this product, on a fourteen-day clock the database
 * enforces.
 */

/** mm:ss. A call is minutes long; an hour-long one has bigger problems than its clock. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/* ------------------------------------------------------------------------- *
 * The state of the microphone, said plainly
 * ------------------------------------------------------------------------- */

function Listening({ listening, elapsedMs }: { listening: boolean; elapsedMs: number }) {
  return (
    <span className="flex items-center gap-2" role="status">
      {/*
        A square, not a circle, and it does not blink. The whole system draws
        state as a 1.5px square dot; a pulsing light on the edge of the screen
        during a phone call is an interruption dressed as information.
      */}
      <span
        aria-hidden="true"
        className={`size-1.5 ${listening ? 'bg-live' : 'bg-ink-ghost'}`}
      />
      <span className={`label ${listening ? 'text-live' : 'text-ink-faint'}`}>
        {listening ? 'Listening' : 'Not listening'}
      </span>
      {listening ? <span className="font-data text-sm text-live">{clock(elapsedMs)}</span> : null}
    </span>
  )
}

/**
 * How much of what was said is still only in this tab.
 *
 * Silent when there is nothing outstanding, which is almost always. It exists
 * for the case it names: the network went, the words are still here, and the
 * operator is entitled to know before he closes the tab.
 */
function SaveState({ state, unsaved }: { state: string; unsaved: number }) {
  if (state === 'idle' || !unsaved) return null

  const failed = state === 'failed'
  return (
    <span className={`label ${failed ? 'text-alert' : 'text-ink-faint'}`} role="status">
      {failed ? `${unsaved} unsaved — retrying` : `saving ${unsaved}`}
    </span>
  )
}

/* ------------------------------------------------------------------------- *
 * Consent, and where the audio goes
 * ------------------------------------------------------------------------- */

/**
 * The two sentences that have to be on this screen and not in a README.
 *
 * A NOTE, NOT A LOCK, and that is the operator's own instruction. The checkbox
 * records that he said it; it does not stand between him and the button. The
 * argument is practical rather than lax: the moment consent matters most is the
 * moment somebody has just asked who is calling, and a surface that answered
 * that by refusing to start would train him to tick the box in advance —
 * which is how a consent record becomes a formality that records nothing.
 * `consent_not_noted` in the tip vocabulary is the other half of this, and it
 * speaks up rather than blocks, on the same reasoning.
 *
 * The disclosure below it is the provider's own sentence, from
 * `TranscriptProvider.disclosure`, so it changes when the recogniser does. With
 * Chrome's it says the audio goes to Google — the same caveat as recording
 * somebody, and it belongs where he can see it while deciding to press Start.
 */
function ConsentNotice({
  callId,
  consentNoted,
  disclosure,
  sendsAudioOffDevice,
}: {
  callId: string
  consentNoted: boolean
  disclosure: string
  sendsAudioOffDevice: boolean
}) {
  const router = useRouter()

  async function toggle(next: boolean) {
    try {
      await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentNoted: next }),
      })
      router.refresh()
    } catch (error) {
      console.error('[call] could not record the consent note', error)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-dim">
        <input
          type="checkbox"
          checked={consentNoted}
          onChange={(event) => void toggle(event.target.checked)}
          className="size-3.5 accent-signal"
        />
        I told them the call is being transcribed
      </label>
      <p
        className={`max-w-[52ch] text-right text-xs ${
          sendsAudioOffDevice ? 'text-ink-faint' : 'text-ink-ghost'
        }`}
      >
        {disclosure}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * The middle column
 * ------------------------------------------------------------------------- */

/**
 * One line, timestamped, unattributed.
 *
 * NO SPEAKER LABEL, and the blank space where one would go is deliberate. One
 * microphone on a speakerphone hears one room; `speaker` is `unknown` on every
 * row this surface writes, and a column that printed "—" against each line would
 * be a column asking to be filled in with a guess. The timestamp is what the
 * transcript is actually indexed by.
 */
function Line({ segment }: { segment: TranscriptSegment }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="shrink-0 font-data text-micro text-ink-ghost tabular-nums">
        {clock(segment.atMs)}
      </span>
      <span className="text-lg leading-snug text-ink">{segment.text}</span>
    </li>
  )
}

function Transcript({
  segments,
  interim,
  listening,
}: {
  segments: TranscriptSegment[]
  interim: string
  listening: boolean
}) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  /*
   * Follows the conversation, unless he has scrolled back to check something —
   * which is the one reason he would ever touch this column mid-call, and
   * yanking him back to the bottom two seconds later would make it useless.
   * Re-pins itself when he returns to the end.
   */
  function onScroll() {
    const el = scrollerRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [segments.length, interim])

  return (
    <div ref={scrollerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {segments.length === 0 && !interim ? (
        <p className="text-base text-ink-ghost">
          {listening
            ? 'Listening. Nothing recognised yet.'
            : 'Nothing yet. Press Start when the line connects.'}
        </p>
      ) : (
        <ol className="space-y-2.5">
          {segments.map((segment, index) => (
            <Line key={`${segment.atMs}-${index}`} segment={segment} />
          ))}
        </ol>
      )}

      {/*
        The recogniser's current guess. Green because it is the most transient
        thing on the screen — it will be replaced by a better guess or by the
        final line, and it is never written to a row.
      */}
      {interim ? (
        <p className="mt-2.5 pl-[3.25rem] text-lg leading-snug text-live/80" aria-live="off">
          {interim}
        </p>
      ) : null}

      <div ref={endRef} />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * The right column
 * ------------------------------------------------------------------------- */

/**
 * One tip. Read with half an eye, mid-sentence.
 *
 * NO COLOUR, AND THAT IS THE DECISION. DESIGN.md allows amber one meaning per
 * surface and this surface already spends it on Start/Stop — the one thing on
 * the page he presses. Green is transient data, which this is not: a tip is
 * kept in `call_tips` long after the transcript beside it has expired. So the
 * card earns attention with size and with an empty column around it, which are
 * the two things that cost nothing while somebody is talking.
 *
 * NOTHING MOVES. No fade in, no pulse, no countdown ring. Motion at the edge of
 * vision is the one thing guaranteed to pull attention off a conversation, and
 * a tip that did that would cost more than it gave back on every call where it
 * was wrong.
 */
function TipCard({ tip }: { tip: ShownLiveTip }) {
  return (
    <div className="border-l-2 border-rule-strong bg-panel px-4 py-3" role="status">
      <p className="label text-ink-faint">{TIP_SPECS[tip.trigger].label}</p>
      <p className="mt-2 text-2xl leading-snug text-ink">{tip.body}</p>

      {/*
        His own verdict, echoed back so the keypress is visibly not a no-op.
        Quiet, because it is a note to a table read months from now — the tip
        itself is the thing on this card worth looking at.
      */}
      {tip.actedOn ? <p className="label mt-2.5 text-ink-ghost">used</p> : null}
    </div>
  )
}

/**
 * The three keys, said once, permanently.
 *
 * A legend rather than a hint that appears when it is relevant: a control he
 * has to discover mid-call is a control he will not use, and three words in
 * micro type at the foot of an otherwise empty column cost nothing to ignore.
 */
function TipKeys({ asking }: { asking: boolean }) {
  return (
    <div className="border-t border-rule px-4 py-1.5">
      <p className="font-data text-micro text-ink-ghost">
        {asking ? 'asking…' : 'esc hide · enter used · a ask'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * The whole thing
 * ------------------------------------------------------------------------- */

export interface CallAssistantProps {
  callId: string
  leadId: string
  leadName: string
  leadPhone: string | null
  leadCity: string | null
  consentNoted: boolean
  closed: boolean
  initialSegments: TranscriptSegment[]
  /** The Phase 14 briefing, rendered on the server and passed through whole. */
  briefing: ReactNode
  /**
   * The same briefing, as data, for the rules to read.
   *
   * Not a duplicate of the node above and not replaceable by it. One is what
   * the operator reads in the left column; this one is what `nextTip` searches
   * for a prepared answer to a trigger, and a React element cannot be searched.
   */
  prepared: Briefing | null
  /** Tips already shown in this call. Read back so a reload does not repeat them. */
  initialTips: ShownTip[]
  /** The summary this call already has, when it has one. Null before Stop. */
  initialSummary: StoredSummary | null
  /** `calls.outcome`, when it has been filed. */
  initialOutcome: string | null
}

export function CallAssistant({
  callId,
  leadId,
  leadName,
  leadPhone,
  leadCity,
  consentNoted,
  closed,
  initialSegments,
  briefing,
  prepared,
  initialTips,
  initialSummary,
  initialOutcome,
}: CallAssistantProps) {
  const router = useRouter()

  const summary = useCallSummary({
    callId,
    leadId,
    initialSummary,
    initialOutcome,
  })

  const call = useCallTranscript({
    callId,
    initialSegments,
    closed,
    /*
     * THE SUMMARY IS FIRED BY THE STOP BUTTON AND BY NOTHING ELSE.
     *
     * `onClosed` runs once, after the queue has drained and the server has
     * stamped `ended_at` — so the words the summary is written from are the
     * whole call rather than the whole call minus the last three seconds. It
     * deliberately does not run on unmount: a tab closed at minute six, a route
     * change, a laptop lid. A summary generated by walking away is one nobody
     * reads, and it lands with `accepted` null forever — which is the state that
     * means "he has not looked yet", and enough of them would make the one
     * number `call_summaries` exists to produce stop meaning anything.
     *
     * A closed call that has no summary — because this failed, or because the
     * tab went — still offers a button. The transcript keeps for fourteen days
     * and the offer stands for as long as it does.
     */
    onClosed: () => {
      router.refresh()
      summary.generate()
    },
  })

  const tips = useLiveTips({
    callId,
    segments: call.segments,
    elapsedMs: call.elapsedMs,
    listening: call.listening,
    consentNoted,
    briefing: prepared,
    initialShown: initialTips,
  })

  /*
   * The line has dropped, as this tab sees it.
   *
   * Two sources because they arrive at different times: `closed` is the row and
   * is right on every load, and the local status is right in the second between
   * pressing Stop and `router.refresh()` landing. Without the second, the column
   * would still be offering tips while the summary was being written.
   */
  const over = closed || call.status === 'stopped'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ----------------------------------------------------------------- *
       * The band: who he is ringing, and the one control
       * ----------------------------------------------------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-rule-strong bg-panel px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl text-ink">{leadName}</h1>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-sm text-ink-faint">
            {/* The number, big enough to read off and dial. It is why he is here. */}
            {leadPhone ? (
              <a href={`tel:${leadPhone}`} className="font-data text-base text-ink-dim">
                {leadPhone}
              </a>
            ) : (
              <span className="font-data text-base text-ink-ghost">no number</span>
            )}
            {leadCity ? <span>{leadCity}</span> : null}
            <CommandLink href={`/leads/${leadId}`} variant="quiet">
              Diagnosis
            </CommandLink>
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* The consent line sits above the button, where it is read on the way
              to pressing it. Not beside it, and not below. */}
          <ConsentNotice
            callId={callId}
            consentNoted={consentNoted}
            disclosure={call.disclosure}
            sendsAudioOffDevice={call.sendsAudioOffDevice}
          />

          <div className="flex items-center gap-3">
            <SaveState state={call.saveState} unsaved={call.unsaved} />
            <Listening listening={call.listening} elapsedMs={call.elapsedMs} />

            {closed ? (
              <span className="label text-ink-faint">Call closed</span>
            ) : call.listening ? (
              <CommandButton variant="primary" onClick={call.stop}>
                Stop
              </CommandButton>
            ) : (
              <CommandButton variant="primary" onClick={call.start} disabled={!call.available}>
                Start
              </CommandButton>
            )}
          </div>

          {/*
            Which recogniser is behind the button. Small, permanent, and worth
            the two words: a fixture playing back a call that never happened and
            a live microphone look identical in the middle column, and the day
            he wonders why the transcript is word-perfect this is the answer.
          */}
          <p className="font-data text-micro text-ink-ghost">via {call.providerId}</p>
        </div>
      </header>

      {!call.available ? (
        <p className="border-b border-rule border-l border-l-alert bg-panel px-4 py-2 text-sm text-ink">
          This browser cannot recognise speech. Chrome and Edge can; Firefox and Safari cannot. The
          briefing below still works — the transcript will not.
        </p>
      ) : null}

      {call.error ? (
        <p
          className="border-b border-rule border-l border-l-alert bg-panel px-4 py-2 text-sm text-ink"
          role="alert"
        >
          {call.error}
        </p>
      ) : null}

      {/* ----------------------------------------------------------------- *
       * Three columns, each scrolling alone
       * ----------------------------------------------------------------- */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.7fr)]">
        {/* What he prepared. Arrives whole from the lead page — same component,
            same markup, open and unabridged, as the brief requires. */}
        <aside className="min-h-0 overflow-y-auto border-rule lg:border-r" aria-label="Briefing">
          {briefing ?? (
            <p className="px-4 py-3 text-sm text-ink-faint">
              No briefing was prepared for this call. Prepare one from the lead page — or open the
              call cold; the transcript works either way.
            </p>
          )}
        </aside>

        {/* What is being said. */}
        <section
          className="flex min-h-0 flex-col border-rule lg:border-r"
          aria-label="Transcript"
        >
          <div className="flex items-baseline justify-between border-b border-rule bg-panel px-4 py-1.5">
            <h2 className="label text-ink-dim">Transcript</h2>
            {/*
              Said once, here, where the words are. The fourteen days are the
              schema's promise about somebody who never agreed to be recorded,
              and the operator should know the wording goes even though his
              summary stays.
            */}
            <p className="font-data text-micro text-ink-ghost">
              one microphone · no speakers separated · kept 14 days
            </p>
          </div>

          <Transcript
            segments={call.segments}
            interim={call.interim}
            listening={call.listening}
          />
        </section>

        {/*
          What the assistant says, when it has anything to say — and afterwards,
          what it made of the call.

          ONE COLUMN, TWO HALVES OF ONE JOB. The tips are read mid-sentence and
          the summary is read after the line drops, so the two are never both
          wanted; giving the summary a band or a panel of its own would rearrange
          the screen at the exact moment the operator is deciding what to do
          next. The heading says which half is showing.

          EMPTY IS THE NORMAL STATE OF THE TIP HALF and the copy says so rather
          than apologising for it. An assistant that always has something on
          screen is one that gets ignored by minute two, and then it is not there
          for the moment it was built for.
        */}
        <aside className="flex min-h-0 flex-col" aria-label={over ? 'Summary' : 'Tips'}>
          <div className="border-b border-rule bg-panel px-4 py-1.5">
            <h2 className="label text-ink-dim">{over ? 'Summary' : 'Tips'}</h2>
          </div>

          {over ? (
            <CallSummaryPanel state={summary} />
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {tips.current ? (
                  <TipCard tip={tips.current} />
                ) : tips.empty ? (
                  <p className="text-base text-ink-faint">
                    Nothing to add. The prepared objections are on the left.
                  </p>
                ) : (
                  <p className="text-sm text-ink-ghost">
                    {call.listening
                      ? 'Listening. Nothing worth interrupting for.'
                      : 'Tips appear here while the call is running.'}
                  </p>
                )}
              </div>

              <TipKeys asking={tips.asking} />
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
