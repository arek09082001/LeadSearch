'use client'

import { CommandButton } from '@/components/ui/command-button'
import type { CallSummaryState } from '@/components/calls/use-call-summary'
import { CALL_OUTCOMES, outcomeLabel } from '@/lib/assistant/vocabulary'
import type { NoSummaryReason } from '@/lib/assistant/types'
import { shortDate } from '@/lib/leads/dates'

/*
 * The right-hand column, after the line drops.
 *
 * It takes over from the tips, in place, and that is the whole layout decision:
 * one column for what the assistant has to say, holding whichever half of that
 * job is current. Tips are read mid-sentence and the summary is read afterwards,
 * so the two are never both wanted, and moving the summary into a band or a
 * modal would make the screen rearrange itself at the exact moment the operator
 * is deciding what to do next.
 *
 * THIS IS WHERE THE SURFACE SPENDS ITS AMBER, and it is not a second meaning.
 * DESIGN.md allows one accent per surface and this one gives it to the control —
 * Start, then Stop. Once the call is closed there is no Stop button; the thing
 * on this screen he presses is the handover, so the accent moves to it. At no
 * point are two amber meanings on the page at once.
 *
 * EVERY SUGGESTION IS A BUTTON AND NOTHING IS PRE-APPLIED. Three separate takes,
 * because he will believe the paragraph and not the status, or want the callback
 * and none of the prose. What has been taken says so and stops offering itself;
 * what has not stays available until he leaves.
 */

/**
 * Why there is nothing, in the operator's terms rather than the schema's.
 *
 * The two cases get different sentences because he can do something about one of
 * them and not the other. Neither apologises: a call nobody transcribed is an
 * ordinary call, and it is the note field on the lead that is the answer to it.
 */
const NO_SUMMARY_COPY: Record<NoSummaryReason, string> = {
  no_transcript:
    'Nothing was transcribed on this call, so there is nothing to write up. Whatever was said is still worth a note on the lead — by hand, in your own words.',
  transcript_expired:
    'The transcript has passed its fourteen days and been deleted. There is nothing left to summarise, and there will not be again.',
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

/**
 * One suggestion, offered once.
 *
 * The taken state is a line of micro type rather than a disabled button, because
 * a greyed-out control invites a second press to find out why it will not go.
 * This says it is done and gets out of the way.
 */
function Take({
  label,
  taken,
  takenLabel,
  busy,
  onTake,
}: {
  label: string
  taken: boolean
  takenLabel: string
  busy: boolean
  onTake: () => void
}) {
  if (taken) return <p className="label text-ink-ghost">{takenLabel}</p>

  return (
    <CommandButton variant="primary" onClick={onTake} disabled={busy}>
      {label}
    </CommandButton>
  )
}

/**
 * How the call is filed, in his own shorthand.
 *
 * NEVER DERIVED FROM THE SUGGESTION, and that is why it is a row of chips rather
 * than a value the summary arrives carrying. `calls.outcome` is free text
 * because how a call ended is the operator's own word for it; a status the
 * assistant proposed is a different claim by a different author, and filling one
 * column from the other would put the assistant's opinion into the one field
 * that is supposed to be evidence against it.
 *
 * Offered whether or not there is a summary. A call that reached nobody is still
 * a call that has to be filed, and that is exactly the call with no transcript.
 */
function Outcome({ chosen, onFile }: { chosen: string | null; onFile: (key: string) => void }) {
  return (
    <div className="border-t border-rule px-4 py-3">
      <p className="label text-ink-faint">How it ended</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {CALL_OUTCOMES.map((outcome) => {
          const active = chosen === outcome.key
          return (
            <button
              key={outcome.key}
              type="button"
              onClick={() => onFile(outcome.key)}
              aria-pressed={active}
              className={`label border px-2 py-1 transition-colors duration-150 ${
                active
                  ? 'border-signal text-signal'
                  : 'border-rule text-ink-faint hover:border-rule-strong hover:text-ink-dim'
              }`}
            >
              {outcome.label}
            </button>
          )
        })}
      </div>

      {/* An outcome this build has never heard of — typed elsewhere, or left over
          from a vocabulary that has since changed. Shown rather than swallowed. */}
      {chosen && !CALL_OUTCOMES.some((outcome) => outcome.key === chosen) ? (
        <p className="label mt-2 text-ink-ghost">filed as {outcomeLabel(chosen)}</p>
      ) : null}
    </div>
  )
}

export function CallSummaryPanel({ state }: { state: CallSummaryState }) {
  const { summary } = state

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {state.status === 'writing' ? (
          <p className="text-base text-ink-faint" role="status">
            Writing it up…
          </p>
        ) : null}

        {state.status === 'idle' ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-faint">
              No summary yet. The transcript is kept for fourteen days — after that this paragraph
              is the only record of what was said.
            </p>
            <CommandButton variant="primary" onClick={() => state.generate()}>
              Write the summary
            </CommandButton>
          </div>
        ) : null}

        {state.status === 'none' && state.reason ? (
          <p className="text-base text-ink-faint">{NO_SUMMARY_COPY[state.reason]}</p>
        ) : null}

        {state.status === 'failed' ? (
          <div className="space-y-3">
            <p className="border-l border-l-alert bg-panel px-3 py-2 text-sm text-ink" role="alert">
              {state.error ?? 'The summary could not be written.'}
            </p>
            <CommandButton onClick={() => state.generate()}>Try again</CommandButton>
          </div>
        ) : null}

        {summary && state.status === 'ready' ? (
          <div className="space-y-4">
            {/*
              The paragraph, in reading type. It is prose and it is the thing
              that outlives the transcript, so it gets the size a thing meant to
              be read gets — not the size of a caption on three buttons.
            */}
            <p className="text-lg leading-relaxed text-ink">{summary.body}</p>

            {summary.suggestedNextAction ? (
              <p className="border-l-2 border-rule-strong pl-3 text-base leading-snug text-ink-dim">
                {summary.suggestedNextAction}
              </p>
            ) : null}

            <div className="space-y-2 border-t border-rule pt-3">
              <Row>
                <Take
                  label="Save as note"
                  taken={state.taken.note}
                  takenLabel="saved as a note"
                  busy={state.busy}
                  onTake={state.takeNote}
                />
              </Row>

              {summary.suggestedStatus ? (
                <Row>
                  <Take
                    label={`Set to ${summary.suggestedStatus}`}
                    taken={state.taken.status}
                    takenLabel={`status set to ${summary.suggestedStatus}`}
                    busy={state.busy}
                    onTake={state.takeStatus}
                  />
                </Row>
              ) : null}

              {summary.suggestedFollowUpAt ? (
                <Row>
                  <Take
                    label={`Follow up ${shortDate(summary.suggestedFollowUpAt)}`}
                    taken={state.taken.followUp}
                    takenLabel={`follow-up set for ${shortDate(summary.suggestedFollowUpAt)}`}
                    busy={state.busy}
                    onTake={state.takeFollowUp}
                  />
                </Row>
              ) : null}
            </div>

            {state.error ? (
              <p className="border-l border-l-alert bg-panel px-3 py-2 text-sm text-ink" role="alert">
                {state.error}
              </p>
            ) : null}

            {/*
              "I looked and took nothing" is an answer, and a different fact from
              never having looked — which is what `accepted` being null means and
              why the column has no default. Quiet, and beside a way to ask for
              another attempt, because the two are what he does when the summary
              missed the point.
            */}
            <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
              {state.answered ? (
                <p className="label text-ink-ghost">answered</p>
              ) : (
                <CommandButton variant="quiet" onClick={state.dismiss}>
                  Took nothing
                </CommandButton>
              )}
              <CommandButton variant="quiet" onClick={() => state.generate({ regenerate: true })}>
                Write it again
              </CommandButton>
            </div>

            {/*
              Who wrote it. The same two words the call header spends on the
              recogniser, and worth them for the same reason: a fixture and a
              model produce a paragraph that looks identical, and this row is
              about to become the permanent record of a conversation.
            */}
            <p className="font-data text-micro text-ink-ghost">
              via {summary.provider}
              {summary.model ? ` · ${summary.model}` : ''}
            </p>
          </div>
        ) : null}
      </div>

      <Outcome chosen={state.outcome} onFile={state.fileOutcome} />
    </div>
  )
}
