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
 *
 * German strings, English comments; see the note in `no-website.ts`. The
 * restraint above survives translation and is if anything harder in German,
 * where the vocabulary of the subject — Abmahnung, Bußgeld, abmahnfähig —
 * arrives pre-loaded with a threat the audit never measured.
 */
export const NO_IMPRINT: AssistantFixture = {
  key: 'no_imprint',
  title: 'A site with no Impressum',
  claims: ['no_imprint', 'imprint_incomplete', 'no_privacy_policy', 'no_vat_id'],
  requiresWebsite: true,

  briefing: {
    headline: '{name} — die Seite ist online und es steht kein Impressum drauf.',
    opening:
      'Guten Morgen — kurzer und etwas ungewöhnlicher Grund für meinen Anruf. ' +
      'Ich war auf Ihrer Website und habe nirgends ein Impressum gefunden. Steckt es irgendwo, wo ich es übersehen habe?',
    points: [
      {
        label: 'Kein Impressum',
        detail:
          'Auf keiner Seite, und auch unten nichts verlinkt. Bei geschäftlichen Websites in Deutschland gehört eins dazu.',
        code: 'no_imprint',
      },
      {
        label: 'Keine Datenschutzseite',
        detail:
          'Eine Datenschutzerklärung fehlt auch — die beiden fehlen meistens zusammen und werden zusammen erledigt.',
        code: 'no_privacy_policy',
      },
      {
        label: 'Eine halbe Stunde Arbeit',
        detail:
          'Das ist kein Neubau. Das sind zwei Seiten und ein Link unten drunter, und es ist das Billigste an der ganzen Website.',
        code: null,
      },
      {
        label: 'Ein Anlass für den Rest',
        detail:
          'Eine kleine Sache, bei der jemand unter die Haube schaut. Was sonst noch nicht stimmt, fällt dabei auf.',
        code: null,
      },
    ],
    objections: [
      {
        objection: 'Muss das denn überhaupt sein?',
        reply:
          'Bei einer geschäftlichen Seite ist das die Regel, ja — ich bin aber nicht Ihr Anwalt. Was ich Ihnen sagen kann: bei Ihnen fehlen beide Seiten.',
        trigger: null,
      },
      {
        objection: 'Krieg ich jetzt ein Bußgeld?',
        reply:
          'Keine Ahnung, und wer Ihnen sagt, er wüsste es, will Ihnen etwas verkaufen. Ich sage Ihnen, dass die Seite fehlt.',
        trigger: null,
      },
      {
        objection: 'Das hat unsere Agentur gebaut, das ist deren Sache.',
        reply:
          'Wahrscheinlich — es ist trotzdem Ihre Seite mit Ihrem Namen drauf. Eine Mail an die heute ist es wert.',
        trigger: 'already_have_someone',
      },
      {
        objection: 'Schicken Sie mir das mal per Mail.',
        reply:
          'Mache ich gerne. Ich schreibe Ihnen die beiden fehlenden Seiten auf, dann können Sie das weiterleiten an den, der die Website betreut.',
        trigger: 'send_me_an_email',
      },
    ],
    ask: 'Sagen Sie Ja zu der schriftlichen Zusammenfassung, und nehmen Sie sich am Donnerstag fünf Minuten für das, was die Prüfung sonst noch ergeben hat.',
    avoid: [
      'Nicht sagen, sie verstoßen gegen das Gesetz. Das Audit hat eine fehlende Seite gefunden, es hat nicht ihren Betrieb geprüft.',
      'Keine Abmahnungen, keine Bußgelder, keine Beträge. Nichts hier trägt eine Zahl, und der Anruf wird damit zur Drohung.',
      'Keine rechtliche Einschätzung abgeben, auch keine beruhigende. Nicht die Aufgabe, und es ist die eine Aussage, auf die sie handeln könnten.',
      'Nicht sagen, das sei in fünf Minuten erledigt, wenn sie es sofort wollen. Fünf Minuten Arbeit brauchen trotzdem ihre Daten.',
    ],
  },

  tips: [
    {
      trigger: 'privacy_worry',
      cues: ['woher haben sie', 'wie kommen sie an', 'meine daten', 'wer hat ihnen', 'dsgvo', 'datenschutz'],
      body: 'Google-Eintrag und ihre Website. Gerade hier sauber beantworten.',
    },
    {
      trigger: 'already_have_someone',
      cues: ['die agentur', 'unser webmensch', 'hat jemand gebaut', 'eine firma', 'mein neffe'],
      body: 'Bleibt ihre Seite. Mailadresse vom Betreuer holen, dahin mitschicken.',
    },
    {
      trigger: 'no_time',
      cues: ['machen sie schnell', 'keine zeit', 'mitten in', 'ungünstig', 'hab kunden'],
      body: 'Ein Satz: kein Impressum auf der Seite. Dann E-Mail-Adresse holen.',
    },
    {
      trigger: 'send_me_an_email',
      cues: ['schicken sie mir', 'schriftlich', 'per mail', 'schicken sie was'],
      body: 'Ja — und vor dem Auflegen einen Tag für den Rückruf holen.',
    },
    {
      trigger: 'price_question',
      cues: ['was kostet', 'wie teuer', 'was verlangen sie'],
      body: 'Kleine Sache, und das auch sagen. Kein Paket am Telefon bauen.',
    },
    {
      trigger: 'not_the_decider',
      cues: ['der inhaber', 'mein chef', 'die zentrale', 'nicht meine entscheidung', 'mein mann', 'meine frau'],
      body: 'Den Befund dalassen, nicht den Pitch. Fragen, wann der Chef da ist.',
    },
    {
      trigger: 'buying_signal',
      cues: ['können sie das machen', 'wie schnell', 'was brauchen sie von uns', 'nächster schritt'],
      body: 'Er will es weghaben. Fragen, was sonst noch auf der Seite ist.',
    },
    {
      trigger: 'happy_as_is',
      cues: ['keiner beschwert', 'nie ein problem', 'sind zufrieden', 'seit jahren so'],
      body: 'Nicht streiten und nicht aufblasen. Befund einmal nennen, Mail anbieten.',
    },
  ],

  summary: {
    body:
      'Bei {name} durchgekommen. Kein Impressum und keine Datenschutzseite auf der Website; das war ihnen nicht bewusst. ' +
      'Im Gespräch wurde keine rechtliche Aussage getroffen — der Befund wurde einmal genannt, und sie haben darum gebeten, das schriftlich zu bekommen. ' +
      'Die Website betreut jemand von außen, die Zusammenfassung geht deshalb an beide.',
    suggestedStatus: 'contacted',
    suggestedNextAction:
      'Die zwei fehlenden Seiten schriftlich mailen, den Betreuer in Kopie, Donnerstag zurückrufen.',
    // Three days. "Thursday" is the sentence he will say; the offset is what a
    // date field can be filled from, and the two have to mean the same thing.
    suggestedFollowUpDays: 3,
  },
}
