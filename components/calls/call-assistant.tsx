'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'

import { CommandButton, CommandLink } from '@/components/ui/command-button'
import { useCallTranscript } from '@/components/calls/use-call-transcript'
import type { TranscriptSegment } from '@/lib/assistant/types'

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
}: CallAssistantProps) {
  const router = useRouter()
  const call = useCallTranscript({
    callId,
    initialSegments,
    closed,
    onClosed: () => router.refresh(),
  })

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

        {/* What the assistant will say, once it has anything to say. */}
        <aside className="flex min-h-0 flex-col" aria-label="Tips">
          <div className="border-b border-rule bg-panel px-4 py-1.5">
            <h2 className="label text-ink-dim">Tips</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {/*
              Empty on purpose and not a placeholder graphic. The tip provider is
              the next phase; this column is the space it lands in, and the
              honest thing to put in it meanwhile is a sentence saying nothing is
              watching — so that an empty column is never mistaken for an
              assistant that listened and had no advice.
            */}
            <p className="text-sm text-ink-ghost">
              Nothing is watching this call yet. Live tips are the next phase; the objections
              prepared in the briefing are on the left.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
