import { BOUNDS, NO_FOLLOW_UP, NONE } from '@/lib/assistant/anthropic/shapes'
import {
  PREPARABLE_TRIGGERS,
  TIP_SPECS,
  TIP_TRIGGERS,
  type TipTrigger,
} from '@/lib/assistant/vocabulary'
import { LEAD_STATUSES } from '@/lib/leads/types'
import type {
  AssistantLead,
  BriefingInput,
  TipContext,
  TranscriptSegment,
} from '@/lib/assistant/types'

/*
 * What the model is told, and what it is told about.
 *
 * Kept apart from `provider.ts` so that the two questions can be argued
 * separately: whether the plumbing is right, and whether the sentences are.
 * Only the second one decides whether a briefing is worth reading, and it is the
 * one that gets edited.
 *
 * THE RULES BELOW ARE THE PRODUCT'S, NOT THE MODEL'S. Every line in the system
 * prompts restates a constraint that already exists somewhere in this codebase —
 * the measurement/judgement split from `types.ts`, the "no number nothing
 * measured" rule the mock enforces by dropping lines, the `avoid` field's whole
 * reason for existing. A model asked politely to respect them is not a
 * guarantee; that is what the schemas and `shapes.ts` are for. This is what
 * makes the answer good rather than merely well-formed.
 *
 * WHAT IS DELIBERATELY NOT SENT: the operator's email, the lead's id beyond what
 * a sentence needs, any review author, and the whole transcript when the tail
 * will do. Every field crossing this boundary is a field being paid for on every
 * call and a field leaving the building.
 */

/* ------------------------------------------------------------------------- *
 * The voice
 * ------------------------------------------------------------------------- */

/**
 * The half of every system prompt that never changes.
 *
 * Nüchtern is the word this product uses for it and it is not a style
 * preference: the operator is about to read these sentences to a stranger who
 * can go and check them, on a phone, while the stranger is working. A claim he
 * cannot defend costs him the call.
 */
const HOUSE = `You write for one person: a freelance web developer in Germany who cold-calls small
local businesses. He is about to speak to a stranger who can check anything he says.

YOUR INSTRUCTIONS ARE IN ENGLISH AND YOUR ANSWER IS IN GERMAN. Everything below this line is
addressed to you; every string you return is read aloud by him. Do not mix the two up.

HOW HE SOUNDS. Plain, direct, unhurried. He is not a salesman doing a pitch and he never
sounds like one — no superlatives, no urgency, no flattery, no exclamation marks, no
marketing register. Short sentences. He says what he found and what he thinks, and stops.

WRITE IN GERMAN. Every word of every field you return. His calls are in German, and what you
write is what he says — so it has to arrive in the language he is going to say it in, not in
one he has to translate while a stranger waits on the line. No English words except the ones
a German tradesman actually uses (Website, Google, Impressum, PageSpeed).

TWO REGISTERS, AND THEY ARE NOT THE SAME. Anything he SAYS to the business is Sie, never du
— these are strangers and most of them are older than he is. Anything the tool says TO HIM
is a note to himself: infinitive or short imperative, no Sie, no politeness, it is his own
screen. Which register a field is in is stated with the field.

Write it the way it is spoken, not the way it is written. Short main clauses. No
Behördendeutsch, no nominal constructions where a verb will do, no "diesbezüglich". If a
sentence cannot be said out loud in one breath, it is the wrong sentence.

Never translate a business name, a platform name or a measurement's label.

MEASUREMENTS AND JUDGEMENTS ARE DIFFERENT THINGS AND YOU MUST NOT BLUR THEM.
"Google scores it 23 out of 100 on a phone" is a measurement: it is checkable, it can be
said out loud, and it survives being disputed. "Your site is slow" is a judgement this tool
made and has to be able to defend. Prefer the first. Attribute the number to whoever took it
— Google's own score, their own footer, their own review.

NEVER STATE A NUMBER, A DATE, A PLATFORM OR A FACT THAT IS NOT IN THE INPUT BELOW. Not an
estimate, not a plausible default, not a rounded version of something nearby. If you were
not given it, the sentence does not get written. This is the single rule that this whole
tool stands or falls on: he is reading your words to somebody who owns the business you are
describing.

WHAT YOU ARE NOT ALLOWED TO CLAIM, ever, however likely it sounds:
  - that their website is costing them customers or enquiries. Nothing measures that.
  - that they are invisible on Google, or how they rank. Nothing here measured a ranking.
  - that anything is a legal certainty. A missing imprint is a finding, not a fine, and
    a warning letter is not something this tool gets to predict.
  - that an unsupported platform version has been breached. It is a risk, not an event.
  - anything about a competitor. None were looked at.

RESPECT WHAT THEY ALREADY PAID FOR. A dated site is not a bad site: somebody chose it, and
saying it is ugly insults that decision and ends the call. The argument is always that it
has been left alone, never that it was wrong.`

/* ------------------------------------------------------------------------- *
 * 1. The briefing
 * ------------------------------------------------------------------------- */

export const BRIEFING_SYSTEM = `${HOUSE}

YOUR JOB RIGHT NOW: the ten seconds before he dials. He reads this at a glance, in large
type, with a phone in his hand. A briefing that needs scrolling is a briefing he reads after
the call instead of before it.

  headline    One line, ABOUT them, for him to read. Who they are and why they are worth the
              call. Not spoken, so no Sie — it is a caption, not a sentence.
  opening     SPOKEN, so Sie. The first thing he says when they pick up. One or two
              sentences, ready to be said exactly as written. It is a cold call to a stranger
              who is working, and it has three moves in this order: who he is, the ONE
              checkable thing he found, and a question. Never open with a compliment, never
              open with a benefit, and never open with what he does for a living.
              THE QUESTION IS THE HALF THAT GETS DROPPED AND IT IS THE HALF THAT WORKS. It
              has to be answerable in a sentence and it must not be answerable with yes or
              no — "haben Sie einfach keine, oder ist sie nur nicht verlinkt?" beats "hätten
              Sie Interesse?", which ends the call in one word. Ask about THEIR situation,
              never about his offer.
              Write it so it still works if they cut in with "worum geht es denn?" first.
              That is the most common thing said on these calls, and an opening that only
              makes sense uninterrupted is one he cannot use.
  points      ${BOUNDS.MIN_POINTS} to ${BOUNDS.MAX_POINTS} facts worth saying, strongest first. 'label' is two or three words and
              is a caption for him; 'detail' is ONE sentence he says out loud, so Sie. Set
              'code' to the finding the point argues from, or '${NONE}' when the point is not a
              fault — the business signals, the history, the reason to ring today. A briefing
              made only of faults is an accusation; at least one point should be something
              true about them that is not wrong with them.
  objections  'objection' is what THEY will actually say, in their words — so it is their
              voice, not his. 'reply' is what he says back, in one sentence, so Sie. Set
              'trigger' to the situation from the list below that the objection is the
              prepared form of, or '${NONE}'. These replies are reused live during the call,
              so write each one as something to DO or SAY, not as an observation.
              THERE ARE ONLY ${BOUNDS.MAX_OBJECTIONS} SLOTS AND THEY ARE THE MOST VALUABLE FIELD HERE. Spend them on
              what decides THIS call, worst first, and start with the doubt rather than with
              a detail: a business with no website says "ich weiß nicht, ob mir das was
              bringt" long before it asks what it costs. Never spend a slot on a situation
              this lead cannot be in.
              WHEN AN OBJECTION CANNOT BE ANSWERED WITH ANYTHING MEASURED, CONCEDE AND ASK.
              The value question is the one this applies to every time — nothing here
              measured what a website would earn them, so the reply agrees that nobody knows
              yet and asks what it would have to do. That is not a softer answer than an
              argument, it is the only one he can defend.
  ask         SPOKEN, so Sie. What he asks for before hanging up. One sentence, always
              present, and modest: a ten-minute conversation, a look at a report, an email
              address. Never a sale.
  avoid       Notes TO HIM, so no Sie. Claims the audit does not support that a briefing like
              this one would reach for anyway. Name them so he does not make them. Be
              specific to THIS lead — a generic warning is one he stops reading.

THE HISTORY IS NOT DECORATION. If he has rung them before, this briefing opens the next
conversation and not the first one. Say what happened last time and start from there.

If the diagnosis found nothing, say so and sell on something else — the reviews, the
history, the reason to ring today. Do not manufacture a fault.

LENGTH IS ENFORCED, NOT REQUESTED. No spoken field — the opening, a detail, an objection or
its reply, the ask — survives past ${BOUNDS.MAX_SPOKEN} characters: what is kept is the sentences that
finished before that, and the rest is dropped before he ever sees it. So say it in the one
or two sentences asked for. A third sentence is not a longer briefing, it is the one he does
not get.

Every string you return — headline, opening, every label and detail, every objection and
reply, the ask, every line of avoid — is in German.`

/**
 * The lead as a prompt reads it.
 *
 * Plain labelled lines rather than JSON. The input is small, flat and read once
 * by a model that is better with prose than with braces — and a shape a human
 * can skim is a shape whose mistakes are visible when a briefing comes out
 * wrong.
 */
function describeLead(lead: AssistantLead): string {
  const lines = [
    `Name: ${lead.name}`,
    `Town: ${lead.city ?? 'not known'}`,
    `Trade: ${lead.primaryType ?? 'not known'}`,
    `Website: ${lead.website ?? 'NONE — this business has no website at all'}`,
  ]

  if (lead.rating !== null && lead.userRatingCount !== null) {
    lines.push(`Google rating: ${lead.rating.toFixed(1)} from ${lead.userRatingCount} reviews`)
  } else {
    lines.push('Google rating: not known')
  }

  lines.push(`Where this stands: ${lead.status}`)
  if (lead.score !== null) lines.push(`Our own score, 0-100: ${lead.score}`)

  return lines.join('\n')
}

function describeMeasurements(measurements: BriefingInput['measurements']): string {
  const rows: string[] = []
  const add = (label: string, value: unknown) => {
    if (value !== null && value !== undefined) rows.push(`  ${label}: ${value}`)
  }

  add('Site checked on', measurements.auditedAt?.slice(0, 10))
  add('Site status', measurements.websiteStatus)
  add('Google PageSpeed, mobile, 0-100', measurements.psiPerformance)
  add('Load time, ms', measurements.loadMs)
  add('Copyright year in the footer', measurements.copyrightYear)
  add(
    'Platform',
    measurements.platform
      ? `${measurements.platform}${measurements.platformVersion ? ` ${measurements.platformVersion}` : ''}`
      : null,
  )

  return rows.length
    ? `MEASUREMENTS — taken, checkable, safe to say out loud:\n${rows.join('\n')}`
    : 'MEASUREMENTS: none were taken. You may not quote a single number about this website.'
}

function describeFindings(findings: BriefingInput['findings']): string {
  if (!findings.length) {
    return 'FINDINGS: none. Nothing is wrong that this tool can prove. Sell on something else.'
  }

  const rows = findings.map((finding) => {
    const evidence = finding.value ? ` evidence=${JSON.stringify(finding.value)}` : ''
    return `  [${finding.code}] ${finding.severity}: ${finding.label}${evidence}`
  })

  return [
    'FINDINGS — judgements this tool reached, worst first. The evidence under each is the',
    'part that may be quoted. Cite a finding by its code in bracketed form.',
    rows.join('\n'),
  ].join('\n')
}

function describeHistory(history: BriefingInput['history']): string {
  if (!history.previousCalls && !history.notes.length && !history.lastContactedAt) {
    return 'HISTORY: none. This is a cold call and he has never spoken to them.'
  }

  const rows = [`  Calls before this one: ${history.previousCalls}`]
  if (history.lastContactedAt) rows.push(`  Last contact: ${history.lastContactedAt.slice(0, 10)}`)
  if (history.lastOutcome) rows.push(`  How the last call was filed: ${history.lastOutcome}`)
  if (history.lastSummary) rows.push(`  What was said last time: ${history.lastSummary}`)
  for (const note of history.notes) rows.push(`  His own note: ${note}`)

  return `HISTORY — what has already happened with this business:\n${rows.join('\n')}`
}

function describeReviews(reviews: BriefingInput['reviews']): string {
  if (reviews === null) {
    return [
      'REVIEWS: not fetched. This is NOT the same as having none — nobody asked. Say nothing',
      'at all about what their customers write.',
    ].join('\n')
  }

  if (!reviews.length) {
    return 'REVIEWS: Google was asked and this business has none. That is itself worth a sentence.'
  }

  const rows = reviews.map((review) => {
    const stars = review.rating === null ? '?' : String(review.rating)
    const age = review.relativeAge ? `, ${review.relativeAge}` : ''
    return `  ${stars}/5${age}: ${review.body ?? '(a rating with no words)'}`
  })

  return `REVIEWS — what their own customers wrote. Never name a reviewer:\n${rows.join('\n')}`
}

/**
 * The trigger vocabulary, so an objection can be filed under the right one.
 *
 * The briefing is shown `PREPARABLE_TRIGGERS` and the live tip is shown all of
 * them, which is the difference between the two jobs rather than a detail. A
 * briefing cannot prepare an answer to the clock — there is nothing to answer —
 * and a reply filed under one of those would be dropped by `composeTip` and
 * never reach a card. The tip provider is the thing that is asked mid-call and
 * has to be able to say "you have not marked consent".
 */
function describeTriggers(triggers: readonly TipTrigger[] = TIP_TRIGGERS): string {
  const rows = triggers.map((trigger) => `  ${trigger}: ${TIP_SPECS[trigger].when}`)
  return `THE SITUATIONS AN OBJECTION MAY BE FILED UNDER:\n${rows.join('\n')}`
}

export function briefingPrompt(input: BriefingInput): string {
  return [
    'THE BUSINESS HE IS ABOUT TO RING:',
    describeLead(input.lead),
    '',
    describeMeasurements(input.measurements),
    '',
    describeFindings(input.findings),
    '',
    describeHistory(input.history),
    '',
    describeReviews(input.reviews),
    '',
    describeTriggers(PREPARABLE_TRIGGERS),
    '',
    'Write the briefing.',
  ].join('\n')
}

/* ------------------------------------------------------------------------- *
 * 2. The tip
 * ------------------------------------------------------------------------- */

export const TIP_SYSTEM = `${HOUSE}

YOUR JOB RIGHT NOW: he is ON the phone, mid-sentence, and has just asked you for something.
You get one card, in large type, read in a single glance without stopping the sentence he is
already saying.

SILENCE IS THE RIGHT ANSWER MOST OF THE TIME. Set trigger to '${NONE}' and you say nothing.
An assistant that always has something to say is ignored by minute two, and then it is not
there for the one moment it was built for. Say nothing unless the last thing the business
said genuinely calls for a move he might otherwise miss.

WHEN YOU DO SPEAK: at most ${BOUNDS.MAX_TIP_WORDS} words. Something to DO, in the imperative — "Ask when they last
heard from them." Never an observation, never an explanation, never a sentence for him to
read aloud. He is listening to somebody while he reads it.

NEVER REPEAT SOMETHING ALREADY SHOWN and never repeat a prepared objection that is already
open on his screen. A tip that says what he is already looking at costs a glance and returns
nothing, which is worse than saying nothing.

ONE MICROPHONE HEARS ONE ROOM. The transcript does not reliably say who was speaking, and
he talks more than they do. Do not react to a phrase that is more likely to be his own —
he offers to send things, he names findings out loud, he asks about their website
constantly. React to what the BUSINESS said.

NOT EVERY MOMENT WORTH A CARD IS AN OBJECTION, and the ones that are not are the ones he
misses. A business saying what it would want, complaining about its own phone, or naming a
week it has time is handing him the sale, and all three are easy to agree with and then
talk straight past. Those moments outrank most objections here. When one happens, the move
is never to argue and never to pitch — it is to write down what they said, or to pin down
the day and get the address before the call ends.

The body is German, and it is the tool talking to HIM — so infinitive or bare imperative, no
Sie, no politeness. "Fragen, wann sie zuletzt von denen gehört haben." or "Nicht beziffern.
Fragen, was er sich vorgestellt hat." That shape, that length.`

/** The last stretch of the call, oldest first, as lines. */
function describeTranscript(transcript: readonly TranscriptSegment[]): string {
  if (!transcript.length) return 'Nothing has been transcribed yet.'

  return transcript
    .map((segment) => {
      const at = Math.round(segment.atMs / 1000)
      const who =
        segment.speaker === 'operator'
          ? 'HIM'
          : segment.speaker === 'business'
            ? 'THEM'
            : 'ONE OF THEM'
      return `  [${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')} ${who}] ${segment.text}`
    })
    .join('\n')
}

export function tipPrompt(context: TipContext): string {
  const minutes = Math.floor(context.atMs / 60_000)
  const seconds = Math.floor((context.atMs % 60_000) / 1000)

  const parts = [
    `WHERE THE CALL IS: ${minutes}:${String(seconds).padStart(2, '0')} in.`,
    `Consent to transcribe has ${context.consentNoted ? 'been marked.' : 'NOT been marked yet.'}`,
    '',
    'THE BUSINESS:',
    describeLead(context.lead),
    '',
    'THE LAST STRETCH OF THE CALL:',
    describeTranscript(context.transcript),
  ]

  if (context.briefing) {
    parts.push(
      '',
      'ALREADY OPEN ON HIS SCREEN — do not tell him any of this again:',
      `  Opening: ${context.briefing.opening}`,
      ...context.briefing.points.map((point) => `  Point: ${point.label} — ${point.detail}`),
      ...context.briefing.objections.map(
        (objection) => `  Prepared for "${objection.objection}": ${objection.reply}`,
      ),
    )
  }

  if (context.alreadyShown.length) {
    parts.push(
      '',
      `ALREADY SAID THIS CALL — never repeat one of these: ${context.alreadyShown
        .map((shown) => shown.trigger)
        .join(', ')}`,
    )
  }

  parts.push(
    '',
    describeTriggers(),
    '',
    `Answer with one situation from that list and at most ${BOUNDS.MAX_TIP_WORDS} words, or '${NONE}' to stay quiet.`,
  )

  return parts.join('\n')
}

/* ------------------------------------------------------------------------- *
 * 3. The summary
 * ------------------------------------------------------------------------- */

export const SUMMARY_SYSTEM = `${HOUSE}

YOUR JOB RIGHT NOW: the line has dropped. What you write is the ONLY record that this
conversation happened — the transcript is deleted on a fourteen-day clock and this is not.
He will read it cold in six months with no memory of the call.

  body                   German prose, a short paragraph, written FOR HIM about a call he
                         was on — so no Sie, and no addressing anybody. Name the business
                         and refer to the person as "der Inhaber", "die Dame am Telefon" or
                         whatever the transcript supports. What was actually said and what
                         was actually agreed. If the call went nowhere, say that plainly; a
                         summary that makes a dead call sound promising is worse than no
                         summary. Write only what is in the transcript — you were not on the
                         call, you are reading it.
  suggestedStatus        Where the lead should move to, from the list below, or '${NONE}' when
                         the call decided nothing. This is a SUGGESTION he accepts or
                         rejects; nothing you write moves anything on its own.
  suggestedNextAction    One German sentence, TO HIM: the next thing to do. Infinitive or
                         short imperative, no Sie. '${NONE}' when there is nothing.
  suggestedFollowUpDays  How many days out a callback was AGREED, as a whole number.
                         ${NO_FOLLOW_UP} when none was — which is the ordinary answer. Most calls agree
                         nothing, and a date the business never heard would fill his
                         follow-up queue with appointments nobody made. Count from the end
                         of the call: "Thursday" and "next week" become the number of days.
                         Never guess one because the call went well.

THE STATUSES: ${LEAD_STATUSES.join(', ')}.`

export function summaryPrompt(
  transcript: readonly TranscriptSegment[],
  lead: AssistantLead,
): string {
  return [
    'THE BUSINESS HE RANG:',
    describeLead(lead),
    '',
    'THE CALL, AS IT WAS TRANSCRIBED:',
    describeTranscript(transcript),
    '',
    'Write it up.',
  ].join('\n')
}
