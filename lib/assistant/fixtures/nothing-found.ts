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
 *
 * German strings, English comments; see the note in `no-website.ts`.
 */
export const NOTHING_FOUND: AssistantFixture = {
  key: 'nothing_found',
  title: 'Nothing wrong worth opening on',
  claims: [],
  // Either. It is the call you have left when nothing else claims it, and that
  // happens to a lead with a clean site and to one with no site to check.
  requiresWebsite: null,

  briefing: {
    headline: '{name} — nichts kaputt. Der hier wird über den Betrieb verkauft, nicht über die Seite.',
    opening:
      'Guten Morgen — ich schaue mir an, wie Betriebe in {city} online dastehen, und Ihrer steht besser da als das meiste, was ich sehe. ' +
      'Deswegen rufe ich eigentlich an.',
    points: [
      {
        label: 'Kein Aufhänger',
        detail:
          'Die Prüfung hat nichts gefunden, womit sich argumentieren ließe. Im Gespräch auch nicht danach suchen.',
        code: null,
      },
      {
        label: '{rating}★, {reviews} Bewertungen',
        detail:
          'Gut angesehen. Das ist das Thema, über das es sich zu reden lohnt, und das, worauf sie stolz sind.',
        code: null,
      },
      {
        label: 'Fragen statt erzählen',
        detail:
          'Es gibt keinen Befund, mit dem sich anfangen ließe. Die ersten zwei Minuten sind deshalb Fragen.',
        code: null,
      },
      {
        label: 'Kurz ist hier gut',
        detail:
          'Kein Aufhänger heißt kein Grund, sie festzuhalten. Herausfinden, was als Nächstes ansteht, oder auflegen.',
        code: null,
      },
    ],
    objections: [
      {
        objection: 'Worum geht es denn genau?',
        reply:
          'Ehrlich gesagt — Sie sind mir als einer der besseren aufgefallen, und ich wollte wissen, was bei Ihnen als Nächstes ansteht.',
        trigger: null,
      },
      {
        objection: 'Wir suchen nichts.',
        reply: 'Verstanden. Darf ich eine Frage stellen und Sie dann in Ruhe lassen?',
        trigger: 'happy_as_is',
      },
      {
        objection: 'Was kostet das?',
        reply: 'Da gibt es noch nichts zu beziffern — ich weiß ja nicht, was Sie gemacht haben wollen.',
        trigger: 'price_question',
      },
    ],
    ask: 'Eine Frage: Was würden Sie daran ändern, wie Leute Sie finden, wenn es umsonst wäre?',
    avoid: [
      'Keinen Befund erfinden. Das Audit hat keinen gefunden, und ein ausgedachter ist in dreißig Sekunden überprüft.',
      'Den Anruf nicht strecken. Nichts gefunden heißt, es gibt wirklich weniger zu sagen.',
      'Keine mehr Besucher, mehr Anfragen oder besseres Ranking versprechen. Nichts davon wurde hier gemessen.',
    ],
  },

  tips: [
    {
      trigger: 'what_is_this_about',
      cues: ['worum geht es', 'worum gehts', 'um was geht es', 'was wollen sie', 'was ist denn los'],
      body: 'Ehrlich sein: nichts gefunden. Deshalb die eine Frage.',
    },
    {
      /*
       * The value question lands hardest on this call, and that is why it is
       * here rather than only in `no_website`. Every other fixture has a finding
       * to answer it with; this one has nothing wrong to point at, so the only
       * honest reply is the question back.
       */
      trigger: 'doubts_the_value',
      cues: ['weiß nicht ob', 'weiß auch nicht ob', 'was bringt mir das', 'brauche ich sowas', 'ob sich das lohnt'],
      body: 'Nicht überzeugen wollen. Fragen, was ihm fehlen würde.',
    },
    {
      trigger: 'named_a_need',
      cues: ['müsste mir', 'für mich das wichtigste', 'wäre mir wichtig', 'wäre nicht schlecht'],
      body: 'Da ist der Aufhänger. Seine Worte notieren.',
    },
    {
      trigger: 'slot_named',
      cues: ['hätte ich puffer', 'eher schlecht', 'passt mir', 'da kann ich', 'kalenderwoche'],
      body: 'Tag und Uhrzeit fest. Dann E-Mail-Adresse holen.',
    },
    {
      trigger: 'happy_as_is',
      cues: ['suchen nichts', 'sind zufrieden', 'keiner beschwert', 'passt schon', 'läuft gut'],
      body: 'Zustimmen, die eine Frage stellen und auflegen.',
    },
    {
      trigger: 'no_time',
      cues: ['machen sie schnell', 'keine zeit', 'mitten in', 'ungünstig'],
      body: 'Kein Aufhänger da. Bedanken und beenden, Wohlwollen nicht verbrauchen.',
    },
    {
      trigger: 'price_question',
      cues: ['was kostet', 'wie teuer', 'was verlangen sie'],
      body: 'Kein Umfang, keine Zahl. Fragen, was gemacht werden soll.',
    },
    {
      trigger: 'buying_signal',
      cues: ['wollten wir schon', 'haben überlegt', 'nächster schritt', 'könnten sie', 'was machen sie'],
      body: 'Da ist es. Aufhören zu reden und beschreiben lassen.',
    },
    {
      trigger: 'not_the_decider',
      cues: ['der inhaber', 'mein chef', 'die zentrale', 'nicht meine entscheidung'],
      body: 'Kein Pitch zum Dalassen. Namen holen und später anrufen.',
    },
    {
      trigger: 'privacy_worry',
      cues: ['woher haben sie', 'wie kommen sie an', 'meine daten', 'wer hat ihnen'],
      body: 'Ihr öffentlicher Google-Eintrag. Sagen und weiter.',
    },
  ],

  summary: {
    body:
      'Bei {name} durchgekommen. Das Audit hat keinen Aufhänger ergeben, das Gespräch wurde deshalb über Fragen geführt statt über einen Pitch. ' +
      'Gut bewertet, an der Website nichts Auffälliges. Nichts vereinbart; es gab auch keinen Grund nachzusetzen.',
    suggestedStatus: 'contacted',
    suggestedNextAction: null,
    // Null, and it is the point of this fixture rather than a gap in it. Nothing
    // was agreed, so there is no day to propose — and a surface that offered one
    // anyway would be putting a callback in the queue that the business never
    // heard about.
    suggestedFollowUpDays: null,
  },
}
