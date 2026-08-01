import type { AssistantFixture } from '@/lib/assistant/fixtures/types'

/*
 * The compliance call, and the one to be most careful with.
 *
 * A German business site without an Impressum is a real and specific gap, and
 * it is the fastest call in the book precisely because the owner already half
 * knows. That is also what makes it the easiest to turn into a threat — and a
 * cold call that implies a fine is coming is a call this tool should not be
 * capable of making. The whole argument is one sentence of fact plus an offer;
 * everything past that is scaring a stranger about the law on a Tuesday
 * morning.
 *
 * So the `avoid` list here is longer than the points list, deliberately. What
 * the audit found is a missing page. What it did not find is a lawyer, a
 * deadline, or a legal opinion about their particular business.
 */
export const NO_IMPRINT: AssistantFixture = {
  key: 'no_imprint',
  title: 'A site with no Impressum',
  claims: ['no_imprint', 'imprint_incomplete', 'no_privacy_policy', 'no_vat_id'],
  requiresWebsite: true,

  briefing: {
    headline: '{name} — the site is live and there is no Impressum on it.',
    opening:
      'Good morning — quick and slightly unusual reason for calling. ' +
      'I was on your website and could not find an Impressum anywhere. Is it hidden somewhere I missed?',
    points: [
      {
        label: 'No Impressum',
        detail:
          'Nothing on any page, and nothing linked from the footer. Business sites in Germany are expected to carry one.',
        code: 'no_imprint',
      },
      {
        label: 'No privacy page',
        detail: 'No Datenschutzerklärung either — the two are usually missing together and fixed together.',
        code: 'no_privacy_policy',
      },
      {
        label: 'Half an hour of work',
        detail:
          'This is not a rebuild. It is two pages and a footer link, and it is the cheapest thing on the site to put right.',
        code: null,
      },
      {
        label: 'A reason to look at the rest',
        detail:
          'It is a small job that gets someone under the bonnet. Whatever else is wrong turns up while it is being done.',
        code: null,
      },
    ],
    objections: [
      {
        objection: 'Is that actually required?',
        reply:
          'For a business site, yes, that is the general rule — but I am not your lawyer. What I can tell you is that yours has neither page.',
        trigger: null,
      },
      {
        objection: 'Am I going to get fined?',
        reply:
          'I have no idea, and anybody who tells you they do is selling you something. I am telling you the page is missing.',
        trigger: null,
      },
      {
        objection: 'Our agency built it, that is on them.',
        reply: 'Probably — it is still your site with your name on it. Worth one email to them today.',
        trigger: 'already_have_someone',
      },
      {
        objection: 'Send me an email about it.',
        reply:
          'Happy to. I will put the two missing pages in writing so you can forward it to whoever maintains the site.',
        trigger: 'send_me_an_email',
      },
    ],
    ask: 'Say yes to the written summary, and take five minutes on Thursday to go through what else the check turned up.',
    avoid: [
      'Do not say they are breaking the law. The audit found a missing page; it did not read their business.',
      'Do not mention Abmahnungen, fines, or amounts. Nothing here supports a number and the call becomes a threat.',
      'Do not offer a legal opinion, including a reassuring one. Not the job, and it is the one claim they might act on.',
      'Do not say it is a five-minute fix if they ask you to do it now. Five minutes of work still needs their details.',
    ],
  },

  tips: [
    {
      trigger: 'privacy_worry',
      cues: ['where did you get', 'how do you have', 'my data', 'who gave you', 'dsgvo', 'gdpr'],
      body: 'Public Google listing, and your own website. Answer it straight — you are the one calling about compliance.',
    },
    {
      trigger: 'already_have_someone',
      cues: ['the agency', 'our web guy', 'someone built', 'a company does', 'my nephew'],
      body: 'It is still their site. Ask for the maintainer’s email — send it there too.',
    },
    {
      trigger: 'no_time',
      cues: ['be quick', 'no time', 'in the middle of', 'bad moment', 'customers here'],
      body: 'One sentence: no Impressum on the site. Then ask for an email address.',
    },
    {
      trigger: 'send_me_an_email',
      cues: ['send me an email', 'in writing', 'email me', 'send something over'],
      body: 'Yes — and get a day for the follow-up before you hang up.',
    },
    {
      trigger: 'price_question',
      cues: ['what does it cost', 'how much', 'what would you charge'],
      body: 'Small job, and say so. Do not build a package on the phone.',
    },
    {
      trigger: 'not_the_decider',
      cues: ['the owner', 'my boss', 'head office', 'not my decision', 'my husband', 'my wife'],
      body: 'Leave the fact, not the pitch. Ask when the owner is in.',
    },
    {
      trigger: 'buying_signal',
      cues: ['can you fix', 'how quickly', 'what do you need from us', 'next step', 'send it over'],
      body: 'They want it gone. Ask what else is on the site while you are in there.',
    },
    {
      trigger: 'happy_as_is',
      cues: ['nobody has complained', 'never been a problem', 'we are fine', 'years like that'],
      body: 'Do not argue and do not escalate. State the fact once and offer the email.',
    },
  ],

  summary: {
    body:
      'Reached {name}. No Impressum and no privacy page on the site; they had not realised. ' +
      'No legal claim was made on the call — the fact was stated once and they asked for it in writing. ' +
      'The site is maintained by an outside contact, so the summary goes to both.',
    suggestedStatus: 'contacted',
    suggestedNextAction: 'Email the two missing pages in writing, copy the maintainer, call back Thursday.',
    // Three days. "Thursday" is the sentence he will say; the offset is what a
    // date field can be filled from, and the two have to mean the same thing.
    suggestedFollowUpDays: 3,
  },
}
