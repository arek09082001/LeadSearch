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
 *
 * German strings, English comments; see the note in `no-website.ts`.
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
    headline: '{name} — die Seite läuft noch, und seit Jahren war keiner mehr dran.',
    opening:
      'Guten Morgen — ich schaue mir an, wie kleinere Betriebe in {city} online dastehen. ' +
      'Ich hatte gerade Ihre Seite offen. Darf ich fragen, wer sich heute darum kümmert?',
    points: [
      {
        label: 'Stehengeblieben {year}',
        detail:
          'Unten auf der Seite steht immer noch {year}. Wer sie gepflegt hat, hat aufgehört, und man sieht es.',
        code: 'stale_copyright',
      },
      {
        label: 'PageSpeed {psi}',
        detail:
          'Google gibt der Seite auf dem Handy {psi} von 100. Das ist Googles eigene Zahl, die können Sie in einer Minute nachprüfen.',
        code: 'psi_poor',
      },
      {
        label: 'Nicht fürs Handy gebaut',
        detail:
          'Die Seite ist entstanden, bevor Handys die Mehrheit waren. Die meisten, die sie heute lesen, sitzen an einem.',
        code: 'not_mobile_friendly',
      },
      {
        label: '{platform}, ohne Updates',
        detail:
          'Sie läuft auf {platform}, in einer Version, die keine Sicherheitsupdates mehr bekommt.',
        code: 'outdated_wordpress',
      },
    ],
    objections: [
      {
        objection: 'Die funktioniert doch.',
        reply:
          'Tut sie, auf Ihrem Rechner. Machen Sie sie mal am Handy auf, während wir reden — mich interessiert, was Sie sehen.',
        trigger: 'happy_as_is',
      },
      {
        objection: 'Die Seite hat damals viel gekostet.',
        reply:
          'Bestimmt, und sie hat jahrelang ihren Zweck erfüllt. Ich sage nicht, dass sie schlecht war — ich sage, dass seitdem keiner mehr dran war.',
        trigger: null,
      },
      {
        objection: 'Darum kümmert sich unser Webmensch.',
        reply:
          'Wann haben Sie zuletzt von ihm gehört? Was unten auf der Seite steht, spricht dafür, dass das eine Weile her ist.',
        trigger: 'already_have_someone',
      },
      {
        objection: 'Beschwert hat sich noch keiner.',
        reply:
          'Beschwert sich auch keiner. Die gehen einfach zurück auf die Trefferliste — deshalb merkt man es so schlecht.',
        trigger: null,
      },
    ],
    ask: 'Lassen Sie mich Ihnen den zweiseitigen Google-Bericht zu Ihrer eigenen Seite schicken, und wir reden zehn Minuten, wenn Sie ihn gelesen haben.',
    avoid: [
      'Nicht sagen, die Seite sei hässlich oder schlecht gestaltet. Das hat das Audit nicht gemessen, und sie haben sie ausgesucht.',
      'Keinen Rückgang bei Anfragen auf die Seite schieben. Nichts hier verbindet die beiden.',
      'Das Sicherheitsrisiko nicht als Tatsache benennen. Eine alte Version ist ein Risiko, kein Vorfall.',
    ],
  },

  tips: [
    {
      trigger: 'what_is_this_about',
      cues: ['worum geht es', 'worum gehts', 'um was geht es', 'was wollen sie', 'was ist denn los'],
      body: 'Ein Satz: Handy-Wert und tote Jahreszahl. Dann fragen.',
    },
    {
      trigger: 'named_a_need',
      cues: ['müsste mir', 'für mich das wichtigste', 'wäre mir wichtig', 'wäre nicht schlecht'],
      body: 'Seine Worte notieren. Den Bericht genau darauf zuschneiden.',
    },
    {
      trigger: 'too_many_calls',
      cues: ['viele anrufe', 'ständig am telefon', 'immer die gleichen fragen'],
      body: 'Die Seite kann das beantworten. Weniger Anrufe, nicht mehr.',
    },
    {
      trigger: 'slot_named',
      cues: ['hätte ich puffer', 'eher schlecht', 'passt mir', 'da kann ich', 'kalenderwoche'],
      body: 'Tag und Uhrzeit fest. Dann Adresse für den Bericht.',
    },
    {
      trigger: 'happy_as_is',
      cues: ['funktioniert doch', 'läuft doch', 'keiner beschwert', 'sieht gut aus', 'sind zufrieden'],
      body: 'Bitten, die Seite am Handy aufzumachen. Dann nichts mehr sagen.',
    },
    {
      trigger: 'already_have_someone',
      cues: ['unser webmensch', 'die agentur', 'macht jemand', 'eine firma', 'mein neffe'],
      body: 'Fragen, wann sie zuletzt gehört haben. Die Seite steht seit Jahren.',
    },
    {
      trigger: 'price_question',
      cues: ['was kostet', 'wie teuer', 'ungefähr', 'zu teuer'],
      body: 'Überarbeiten oder neu — fragen, was gemeint ist, bevor beziffert wird.',
    },
    {
      trigger: 'no_time',
      cues: ['mitten in', 'machen sie schnell', 'keine zeit', 'ungünstig', 'hab kunden'],
      body: 'Google-Bericht anbieten statt Gespräch. E-Mail-Adresse holen.',
    },
    {
      trigger: 'send_me_an_email',
      cues: ['schicken sie mir', 'schriftlich', 'schicken sie was', 'per mail'],
      body: 'Gut — der Bericht ist die Mail. Danach einen Tag festmachen.',
    },
    {
      trigger: 'not_the_decider',
      cues: [
        'der inhaber',
        'mein chef',
        'die zentrale',
        'nicht meine entscheidung',
        'mein mann',
        'meine frau',
      ],
      body: 'Namen und wann er da ist. Nicht dem Vertreter pitchen.',
    },
    {
      trigger: 'buying_signal',
      cues: [
        'was hieße das',
        'wie lange',
        'können sie mir zeigen',
        'nächster schritt',
        'was brauchen sie von uns',
      ],
      body: 'Er ist drin. Die zehn Minuten jetzt festmachen.',
    },
    {
      trigger: 'privacy_worry',
      cues: ['woher haben sie', 'wie kommen sie an', 'meine daten', 'wer hat ihnen'],
      body: 'Öffentlicher Google-Eintrag und die eigene Website. Nüchtern.',
    },
  ],

  summary: {
    body:
      'Bei {name} durchgekommen. Die Seite läuft, aber es ist offensichtlich, dass jahrelang keiner mehr dran war — die tote Jahreszahl unten auf der Seite und der PageSpeed-Wert am Handy haben das Gespräch bewegt. ' +
      'Bis sie die Seite am eigenen Handy aufgemacht haben, hielten sie sie für in Ordnung. ' +
      'Gebaut hat sie ursprünglich jemand von außen, zu dem es keinen Kontakt mehr gibt. Zugesagt, sich erst einmal einen schriftlichen Bericht anzuschauen.',
    suggestedStatus: 'contacted',
    suggestedNextAction: 'PageSpeed-Bericht mit dem Handy-Screenshot schicken, in drei Tagen zurückrufen.',
    suggestedFollowUpDays: 3,
  },
}
