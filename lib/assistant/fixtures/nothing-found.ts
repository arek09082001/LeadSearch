import type { AssistantFixture } from '@/lib/assistant/fixtures/types'

/*
 * The fallback, and it is not a filler.
 *
 * The three fixtures beside this one are the three commonest calls. This is
 * every other one: an audit that came back with nothing worth arguing from, or
 * a diagnosis this build has no fixture for. Both are real, and the mock has to
 * answer them the way the real provider will have to — by saying out loud that
 * there is no fault to open on, rather than by reaching for the nearest one.
 *
 * `claims: []` is what makes it the fallback: it never wins a match, and the
 * selector falls through to it when nothing else claims the call.
 *
 * Building it as a fixture rather than as an error is the decision worth
 * defending. A briefing that failed on a clean lead would leave exactly the case
 * the operator most needs help with — a business he has no easy angle on —
 * staring at an error message.
 */
export const NOTHING_FOUND: AssistantFixture = {
  key: 'nothing_found',
  title: 'Nothing wrong worth opening on',
  claims: [],
  // Either. It is the call you have left when nothing else claims it, and that
  // happens to a lead with a clean site and to one with no site to check.
  requiresWebsite: null,

  briefing: {
    headline: '{name} — nothing broken. This one is sold on the business, not the site.',
    opening:
      'Good morning — I look at how businesses in {city} come across online, and yours is in better shape than most of what I see. ' +
      'That is actually why I am calling.',
    points: [
      {
        label: 'No fault to open on',
        detail: 'The check found nothing worth arguing from. Do not go looking for one on the call.',
        code: null,
      },
      {
        label: '{rating}★, {reviews} reviews',
        detail: 'Well thought of. That is the thing worth talking about, and it is the thing they are proud of.',
        code: null,
      },
      {
        label: 'Ask, do not tell',
        detail: 'You have no diagnosis to lead with, so the first two minutes are questions.',
        code: null,
      },
      {
        label: 'A short call is a good outcome',
        detail: 'No angle means no reason to keep them. Find out what they want next, or get off the phone.',
        code: null,
      },
    ],
    objections: [
      {
        objection: 'What is this about, exactly?',
        reply:
          'Honestly — you came up as one of the better ones and I wanted to know what you are working on next.',
        trigger: null,
      },
      {
        objection: 'We are not looking for anything.',
        reply: 'Understood. Can I ask one question and then leave you alone?',
        trigger: 'happy_as_is',
      },
      {
        objection: 'What does it cost?',
        reply: 'Nothing to quote yet — I do not know what you would want doing.',
        trigger: 'price_question',
      },
    ],
    ask: 'One question: what would you change about how people find you, if it were free?',
    avoid: [
      'Do not invent a fault. The audit found none, and a made-up one is checkable in thirty seconds.',
      'Do not pad the call. Nothing found means there is genuinely less to say.',
      'Do not promise more traffic, more enquiries, or a better ranking. Nothing here measured any of them.',
    ],
  },

  tips: [
    {
      trigger: 'happy_as_is',
      cues: ['not looking', 'we are fine', 'happy with', 'no complaints', 'all good'],
      body: 'Agree, ask your one question, and get off the phone.',
    },
    {
      trigger: 'no_time',
      cues: ['be quick', 'no time', 'in the middle of', 'bad moment'],
      body: 'You have no angle. Thank them and end it — do not spend the goodwill.',
    },
    {
      trigger: 'price_question',
      cues: ['what does it cost', 'how much', 'what would you charge'],
      body: 'No scope, no number. Ask what they would want doing.',
    },
    {
      trigger: 'buying_signal',
      cues: ['we have been meaning', 'we were thinking', 'next step', 'could you', 'what do you do'],
      body: 'There it is. Stop talking and let them describe it.',
    },
    {
      trigger: 'not_the_decider',
      cues: ['the owner', 'my boss', 'head office', 'not my decision'],
      body: 'No pitch to leave. Get the name and ring back.',
    },
    {
      trigger: 'privacy_worry',
      cues: ['where did you get', 'how do you have', 'my data', 'who gave you'],
      body: 'Your public Google listing. Say it and move on.',
    },
  ],

  summary: {
    body:
      'Reached {name}. The audit found nothing to open on and the call was run as questions rather than a pitch. ' +
      'Well reviewed, no evident problem with the site. Nothing agreed; no reason to push.',
    suggestedStatus: 'contacted',
    suggestedNextAction: null,
    // Null, and it is the point of this fixture rather than a gap in it. Nothing
    // was agreed, so there is no day to propose — and a surface that offered one
    // anyway would be putting a callback in the queue that the business never
    // heard about.
    suggestedFollowUpDays: null,
  },
}
