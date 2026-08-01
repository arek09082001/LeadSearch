import type { AssistantFixture } from '@/lib/assistant/fixtures/types'

/*
 * The call this whole product is named after.
 *
 * A business Google knows, with reviews and a phone number and no website
 * behind either. The argument writes itself and the danger is entirely in
 * overplaying it: they are not invisible, they are not losing customers in any
 * way anybody has measured, and every one of those claims is checkable by a man
 * who has run his shop for twenty years without one. What is true is narrower
 * and better — people already look them up, and what they find is a Google
 * listing somebody else controls.
 */
export const NO_WEBSITE: AssistantFixture = {
  key: 'no_website',
  title: 'No website at all',
  claims: ['no_website', 'social_only'],
  requiresWebsite: false,

  briefing: {
    headline: '{name} — a listing, a phone number, and nowhere to send anyone.',
    opening:
      'Good morning, this is Lead Engine calling — you came up when I was looking at businesses in {city}. ' +
      'You have a Google listing and nothing behind it; is that on purpose?',
    points: [
      {
        label: 'Reviews, no site',
        detail:
          '{reviews} people took the trouble to review you and there is nothing for the next one to click through to.',
        code: 'no_website',
      },
      {
        label: 'Google owns the page',
        detail:
          'The only page about {name} that exists is one Google put together — you cannot change what it says.',
        code: 'no_website',
      },
      {
        label: 'They are already looking',
        detail:
          'Nobody rings before checking. The search is already happening; the question is only what it turns up.',
        code: null,
      },
      {
        label: 'Whoever answers first',
        detail:
          'Half a dozen competitors in {city} are one click deep. Yours is a phone number and an address.',
        code: null,
      },
    ],
    objections: [
      {
        objection: 'We get all our work by word of mouth.',
        reply:
          'That is exactly why it is worth doing — word of mouth ends with someone typing your name in, and that is the moment I am talking about.',
        trigger: 'happy_as_is',
      },
      {
        objection: 'My nephew was going to build one.',
        reply: 'How long has that been the plan? I am not trying to replace him, I am asking what it is waiting on.',
        trigger: 'already_have_someone',
      },
      {
        objection: 'What does something like that cost?',
        reply:
          'Less than you are expecting, but I would be guessing until I know what you actually need it to do. Can I ask two questions first?',
        trigger: 'price_question',
      },
      {
        objection: 'We are on Facebook.',
        reply:
          'You are, and it is doing something. It is also a page you do not own, in front of people who did not search for you.',
        trigger: null,
      },
    ],
    ask: 'Fifteen minutes later this week to go through what the page would need to say — nothing to prepare.',
    avoid: [
      'Do not say they are invisible on Google. They are not — the listing ranks, and that is the whole reason we found them.',
      'Do not claim lost customers or lost revenue. Nothing here measured that, and the number would be invented.',
      'Do not promise a ranking. Nothing in the audit says anything about where they would place.',
    ],
  },

  tips: [
    {
      trigger: 'already_have_someone',
      cues: ['nephew', 'my son', 'my daughter', 'a friend', 'someone is doing', 'we have an agency'],
      body: 'Ask how long it has been in progress. Do not compete with the nephew.',
    },
    {
      trigger: 'happy_as_is',
      cues: ['word of mouth', 'we do not need', "don't need one", 'been fine', 'plenty of work'],
      body: 'Agree with them. Then: "and when someone hears about you, what do they find?"',
    },
    {
      trigger: 'price_question',
      cues: ['what does it cost', 'how much', 'what would that run', 'expensive'],
      body: 'No number yet. Ask what it would have to do first.',
    },
    {
      trigger: 'no_time',
      cues: ['in the middle of', 'customers waiting', 'be quick', 'no time', 'bad moment'],
      body: 'Take the exit. Ask for a better time and hang up first.',
    },
    {
      trigger: 'send_me_an_email',
      cues: ['send me an email', 'send something over', 'in writing', 'email me'],
      body: 'Agree — then get a day for the follow-up call before you hang up.',
    },
    {
      trigger: 'not_the_decider',
      cues: ['the owner', 'my husband', 'my wife', 'my partner', 'head office', 'not my decision'],
      body: 'Get the name and when they are in. Do not pitch further.',
    },
    {
      trigger: 'buying_signal',
      cues: ['how long would', 'what would we need', 'when could you', 'next step', 'what happens then'],
      body: 'They are in. Stop selling and put a date on it.',
    },
    {
      trigger: 'privacy_worry',
      cues: ['where did you get', 'how do you have my', 'my data', 'who gave you'],
      body: 'Your public Google listing. Say it plainly and move on.',
    },
  ],

  summary: {
    body:
      'Reached {name} in {city}. No website; the Google listing is the whole presence, and they know it. ' +
      'Work comes by word of mouth and they are not unhappy — the opening that landed was what a referral finds when they look you up. ' +
      'Someone in the family had been going to build a site and it has not moved in months. No price discussed.',
    suggestedStatus: 'contacted',
    suggestedNextAction: 'Call back in a week with two examples of one-page sites for a business their size.',
  },
}
