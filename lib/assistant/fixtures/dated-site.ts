import type { AssistantFixture } from '@/lib/assistant/fixtures/types'

/*
 * The site that was built once and never touched again.
 *
 * Harder than the empty case and more common. Something exists, somebody paid
 * for it, and saying it is bad insults a decision they made — so the argument is
 * never "your site is bad". It is that the site has been left alone: a footer
 * year that stopped, a platform version that stopped, a phone layout that was
 * never a consideration when it was built.
 *
 * This is the fixture where the measurement/judgement split earns its keep. The
 * points below quote numbers — a PageSpeed score, a version, a year — because
 * those are checkable while you are on the phone, and "your site is slow" is
 * not.
 */
export const DATED_SITE: AssistantFixture = {
  key: 'dated_site',
  title: 'A website nobody has touched in years',
  claims: [
    'not_mobile_friendly',
    'outdated_wordpress',
    'dated_markup',
    'stale_copyright',
    'psi_poor',
    'psi_weak',
    'poor_lcp',
    'slow_response',
    'diy_platform',
    'free_subdomain',
  ],
  requiresWebsite: true,

  briefing: {
    headline: '{name} — the site still loads, and nobody has been near it in years.',
    opening:
      'Good morning — I look at how small businesses in {city} come across online. ' +
      'I had your site open a minute ago. Can I ask who looks after it these days?',
    points: [
      {
        label: 'Stopped in {year}',
        detail: 'The footer still says {year}. Whoever was maintaining it stopped, and it shows on the page.',
        code: 'stale_copyright',
      },
      {
        label: 'PageSpeed {psi}',
        detail:
          'Google scores it {psi} out of 100 on a phone. That is Google’s own number and they can check it in a minute.',
        code: 'psi_poor',
      },
      {
        label: 'Not built for phones',
        detail:
          'It was built before phones were the majority of visitors. Most of the people reading it are on one.',
        code: 'not_mobile_friendly',
      },
      {
        label: '{platform}, unsupported',
        detail: 'It runs {platform}, on a version that no longer gets security updates.',
        code: 'outdated_wordpress',
      },
    ],
    objections: [
      {
        objection: 'It works fine.',
        reply:
          'It does, on your machine. Pull it up on your phone while we talk — I am interested in what you see.',
        trigger: 'happy_as_is',
      },
      {
        objection: 'We paid a lot for that site.',
        reply:
          'I am sure, and it did its job for years. I am not saying it was a bad site — I am saying nobody has been near it since.',
        trigger: null,
      },
      {
        objection: 'Our web guy handles that.',
        reply: 'When did you last hear from them? The footer suggests it has been a while.',
        trigger: 'already_have_someone',
      },
      {
        objection: 'Nobody has complained.',
        reply: 'Nobody complains. They go back to the results page — that is what makes it hard to notice.',
        trigger: null,
      },
    ],
    ask: 'Let me send you the two-page Google report on your own site, and we speak for ten minutes after you have read it.',
    avoid: [
      'Do not say the site is ugly or badly designed. The audit measured none of that and they chose it.',
      'Do not attribute a drop in enquiries to the site. Nothing here connects the two.',
      'Do not name the security risk as a certainty. An unsupported version is a risk, not a breach.',
    ],
  },

  tips: [
    {
      trigger: 'happy_as_is',
      cues: ['works fine', 'no complaints', 'nobody has said', 'looks alright', 'happy with it'],
      body: 'Ask them to open it on their phone. Then stop talking.',
    },
    {
      trigger: 'already_have_someone',
      cues: ['our web guy', 'the agency', 'someone maintains', 'a company does', 'my nephew'],
      body: 'When did they last hear from them? The footer has not moved in years.',
    },
    {
      trigger: 'price_question',
      cues: ['what does it cost', 'how much', 'ballpark', 'expensive'],
      body: 'Refit or rebuild — ask which they have in mind before quoting.',
    },
    {
      trigger: 'no_time',
      cues: ['in the middle of', 'be quick', 'no time', 'bad moment', 'customers here'],
      body: 'Offer to send the Google report instead. Get an email address.',
    },
    {
      trigger: 'send_me_an_email',
      cues: ['send me an email', 'in writing', 'send something', 'email me'],
      body: 'Good — the report is the email. Agree a day to talk after it.',
    },
    {
      trigger: 'not_the_decider',
      cues: ['the owner', 'my boss', 'head office', 'not my decision', 'my husband', 'my wife'],
      body: 'Name and time they are in. Do not pitch the deputy.',
    },
    {
      trigger: 'buying_signal',
      cues: ['what would that involve', 'how long', 'could you show', 'next step', 'what do you need from us'],
      body: 'They are in. Book the ten minutes now.',
    },
    {
      trigger: 'privacy_worry',
      cues: ['where did you get', 'how do you have', 'my data', 'who gave you'],
      body: 'Public Google listing and your own website. Plainly.',
    },
  ],

  summary: {
    body:
      'Reached {name}. The site is live but has plainly been left alone for years — the dead footer year and the mobile PageSpeed score were what moved the conversation. ' +
      'They believed it was fine until they opened it on their own phone. ' +
      'An outside contact built it originally and is no longer in touch. Agreed to look at a written report before anything else.',
    suggestedStatus: 'contacted',
    suggestedNextAction: 'Send the PageSpeed report with the mobile screenshot, then call back in three days.',
    suggestedFollowUpDays: 3,
  },
}
