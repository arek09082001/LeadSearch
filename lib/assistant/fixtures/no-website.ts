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
 *
 * THE STRINGS ARE GERMAN AND THE COMMENTS ARE NOT. Everything in this file that
 * the operator reads off a screen mid-call is in the language he is about to say
 * it in; everything that explains why is in the language the rest of this
 * codebase is written in. `cues` are German too, and that is a fix rather than a
 * translation — they are matched against a German transcript, and while they
 * were English the mock could not fire a single one of them.
 */
export const NO_WEBSITE: AssistantFixture = {
  key: 'no_website',
  title: 'No website at all',
  claims: ['no_website', 'social_only'],
  requiresWebsite: false,

  briefing: {
    headline: '{name} — ein Eintrag, eine Telefonnummer, und nichts dahinter.',
    opening:
      'Guten Tag, ich habe mir gerade angeschaut, wie Betriebe in {city} online dastehen, und bin bei Ihnen hängengeblieben. ' +
      'Sie haben einen Google-Eintrag und nichts dahinter — ist das Absicht?',
    points: [
      {
        label: 'Bewertungen, keine Seite',
        detail:
          '{reviews} Leute haben sich die Mühe gemacht, Sie zu bewerten, und der nächste hat nichts zum Anklicken.',
        code: 'no_website',
      },
      {
        label: 'Die Seite gehört Google',
        detail:
          'Die einzige Seite über {name}, die es gibt, hat Google zusammengestellt. Sie können nicht ändern, was da steht.',
        code: 'no_website',
      },
      {
        label: 'Die suchen längst',
        detail:
          'Vor dem Anruf schaut jeder nach. Die Suche passiert sowieso — die Frage ist nur, was dabei herauskommt.',
        code: null,
      },
      {
        label: 'Wer zuerst auftaucht',
        detail:
          'Ein halbes Dutzend Betriebe in {city} sind einen Klick entfernt. Sie sind eine Nummer und eine Adresse.',
        code: null,
      },
    ],
    objections: [
      {
        /*
         * FIRST, because it is the call.
         *
         * "Ich weiß nicht, ob mir eine Website was bringt" is the first thing a
         * business with no website says, and the list is read worst-first — by
         * the operator before he dials, and by `manualTip` when he presses a key
         * and asks for something. It was not on this list while the product was
         * named after this exact conversation.
         *
         * THE REPLY CONCEDES. Every argument available for the other side is a
         * claim about their business that nothing here measured — see `avoid`,
         * which forbids three of them by name — so the honest move and the one
         * that works are the same move: agree that nobody knows yet, and ask
         * what it would have to do. The answer is the brief.
         */
        objection: 'Ich weiß nicht, ob mir eine Website was bringt.',
        reply:
          'Ehrlich gesagt weiß ich das auch noch nicht — sagen Sie mir, was sie können müsste, ' +
          'dann sehen wir, ob sich das für Sie überhaupt rechnet.',
        trigger: 'doubts_the_value',
      },
      {
        objection: 'Wir kriegen alles über Empfehlung.',
        reply:
          'Genau deshalb lohnt es sich — eine Empfehlung endet damit, dass jemand Ihren Namen eintippt. Von dem Moment rede ich.',
        trigger: 'happy_as_is',
      },
      {
        objection: 'Mein Neffe wollte mir eine machen.',
        reply:
          'Wie lange ist das schon der Plan? Ich will ihn nicht ersetzen, ich frage nur, woran es hängt.',
        trigger: 'already_have_someone',
      },
      {
        objection: 'Was kostet denn so was?',
        reply:
          'Weniger als Sie denken, aber ich würde raten, solange ich nicht weiß, was die Seite können muss. Darf ich zwei Fragen stellen?',
        trigger: 'price_question',
      },
      {
        objection: 'Wir sind bei Facebook.',
        reply:
          'Sind Sie, und das bringt auch etwas. Es ist nur eine Seite, die Ihnen nicht gehört, vor Leuten, die gar nicht nach Ihnen gesucht haben.',
        trigger: null,
      },
    ],
    ask: 'Fünfzehn Minuten diese Woche, um durchzugehen, was auf der Seite stehen müsste. Vorbereiten müssen Sie nichts.',
    avoid: [
      'Nicht sagen, sie seien bei Google unsichtbar. Sind sie nicht — der Eintrag rankt, deshalb haben wir sie überhaupt gefunden.',
      'Keine verlorenen Kunden und keinen verlorenen Umsatz behaupten. Das hat nichts gemessen, die Zahl wäre erfunden.',
      'Kein Ranking versprechen. Das Audit sagt nichts darüber, wo sie landen würden.',
    ],
  },

  tips: [
    /*
     * The first four are the opening, and they were added after a real call of
     * this exact type went three minutes with nothing on screen — see
     * `LOGISTICS_CALL`. A conversation with a business that has no website is
     * decided before the first objection: they ask what this is about, they
     * confirm there is nothing, they doubt the category, and then — if it is
     * going well — they say what would change their mind. All four happen in
     * the first ninety seconds and none of them is an objection.
     */
    {
      trigger: 'what_is_this_about',
      cues: ['worum geht es', 'worum gehts', 'um was geht es', 'was wollen sie', 'was ist denn los'],
      body: 'Ein Satz: Eintrag ohne Seite. Dann eine Frage stellen.',
    },
    {
      trigger: 'no_website_confirmed',
      cues: ['habe ich keine', 'hab ich keine', 'haben wir keine', 'nie dazu gekommen', 'wollte ich immer mal'],
      body: 'Fragen, wie Kunden ihn heute finden. Noch nichts anbieten.',
    },
    {
      trigger: 'doubts_the_value',
      cues: ['weiß nicht ob', 'weiß auch nicht ob', 'was bringt mir das', 'brauche ich sowas', 'ob sich das lohnt'],
      body: 'Nicht argumentieren. Fragen, was die Seite können müsste.',
    },
    {
      trigger: 'named_a_need',
      cues: ['müsste mir', 'für mich das wichtigste', 'wäre mir wichtig', 'wäre nicht schlecht'],
      body: 'Seine Worte notieren. Das Angebot genau daran aufhängen.',
    },
    {
      trigger: 'too_many_calls',
      cues: ['viele anrufe', 'ständig am telefon', 'komme nicht zum arbeiten', 'immer die gleichen fragen'],
      body: 'Formular und häufige Fragen anbieten. Filtert Anrufe.',
    },
    {
      trigger: 'slot_named',
      cues: ['hätte ich puffer', 'eher schlecht', 'passt mir', 'da kann ich', 'kalenderwoche'],
      body: 'Tag und Uhrzeit fest. Dann E-Mail-Adresse holen.',
    },
    {
      trigger: 'already_have_someone',
      cues: ['neffe', 'mein sohn', 'meine tochter', 'ein bekannter', 'macht mir jemand', 'haben eine agentur'],
      body: 'Fragen, wie lange das schon läuft. Nicht gegen den Neffen reden.',
    },
    {
      trigger: 'happy_as_is',
      cues: ['mundpropaganda', 'über empfehlung', 'brauchen wir nicht', 'brauche ich nicht', 'läuft auch so'],
      body: 'Zustimmen. Dann: und wenn jemand von Ihnen hört, was findet der?',
    },
    {
      trigger: 'price_question',
      cues: ['was kostet', 'wie teuer', 'was würde das kosten', 'preislich'],
      body: 'Noch keine Zahl. Erst fragen, was die Seite können muss.',
    },
    {
      trigger: 'no_time',
      cues: ['keine zeit', 'mitten in', 'machen sie schnell', 'ungünstig', 'auf der baustelle'],
      body: 'Ausstieg nehmen. Nach besserer Zeit fragen und zuerst auflegen.',
    },
    {
      trigger: 'send_me_an_email',
      cues: ['schicken sie mir', 'schriftlich', 'per mail', 'unterlagen'],
      body: 'Zusagen. Vorher einen Tag für den Rückruf festmachen.',
    },
    {
      trigger: 'not_the_decider',
      cues: ['der chef', 'mein mann', 'meine frau', 'der inhaber', 'die zentrale', 'nicht meine entscheidung'],
      body: 'Namen holen und wann er da ist. Nicht weiter pitchen.',
    },
    {
      trigger: 'buying_signal',
      cues: ['wie lange würde', 'was bräuchten wir', 'wann könnten sie', 'nächster schritt', 'was passiert dann'],
      body: 'Er ist drin. Aufhören zu verkaufen und Termin festmachen.',
    },
    {
      trigger: 'privacy_worry',
      cues: ['woher haben sie', 'wie kommen sie an', 'meine daten', 'wer hat ihnen'],
      body: 'Ihr öffentlicher Google-Eintrag. Nüchtern sagen und weiter.',
    },
  ],

  summary: {
    body:
      'Bei {name} in {city} durchgekommen. Keine Website; der Google-Eintrag ist der ganze Auftritt, und das ist ihnen bewusst. ' +
      'Die Arbeit kommt über Empfehlung und sie sind damit nicht unzufrieden — gezogen hat der Einstieg, was eine Empfehlung findet, wenn sie nachschaut. ' +
      'Jemand aus der Familie wollte eine Seite bauen, das liegt seit Monaten. Über Preise wurde nicht gesprochen.',
    suggestedStatus: 'contacted',
    suggestedNextAction: 'In einer Woche zurückrufen, mit zwei Beispielen für Einseiter in der Größenordnung.',
    suggestedFollowUpDays: 7,
  },
}
