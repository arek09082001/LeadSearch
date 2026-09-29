import type { FixtureLine } from '@/lib/transcript/fixtures/speakerphone'

/*
 * A CALL MODELLED ON A REAL ONE, AND DELIBERATELY NOT A TRANSCRIPT OF IT.
 *
 * The shape comes from a run of this tool against a small logistics firm with a
 * Google listing and no website: where the recogniser broke the segments, when
 * each moment arrived, which of them were the business's and which the
 * operator's. Every word below is rewritten. The person on the other end of
 * that call never agreed to have their voice in a public repository, and a
 * fixture that needed their sentences to be useful would be a fixture this
 * project cannot keep. Anyone adding a call here: the same rule applies.
 * Keep the shape, invent the words, and leave out every name and every place.
 *
 * It is here because of what the real call exposed. Under the first version of
 * `TRIGGER_RULES` that conversation produced ONE tip, at 2:32, on the word
 * "schriftlich" — and the operator's own verdict on the run was that the tip was
 * right and that there should have been more of them. Every trigger added since
 * answers to a moment this file reproduces, which is the only way a phrase list
 * stays honest: rules argued from an imagined call drift towards the calls
 * nobody has.
 *
 * WHAT THE INVENTED FIXTURE COULD NOT SHOW, and the reason this one is kept
 * alongside `SPEAKERPHONE_CALL` rather than instead of it:
 *
 *   THE SEGMENTS ARE NOT TURNS. A recogniser listening to a speakerphone does
 *   not break on the change of speaker; it breaks on silence. Line 2 below is
 *   thirty seconds long and contains the operator's opening AND the answer to
 *   it, and line 6 contains most of a two-minute exchange. `speakerHint` is
 *   'both' on those — a value the hand-written fixture never needed and the real
 *   world produced immediately — and it is what stops the demo asserting that a
 *   line "the operator said" fired nothing when half of it was somebody else.
 *
 *   THE OBJECTION IS NOT IN THE LIST. Doubting that a website would bring
 *   anything at all is the first thing this business says, it is the whole
 *   call, and there was no trigger for it. `doubts_the_value` exists because of
 *   that moment, and the tip it fires is the move the operator made by instinct
 *   at 0:47 — asking what the site would have to do — which is what turned the
 *   call around and is worth a card on the ones where instinct is elsewhere.
 *
 *   NOBODY ASKED FOR THE EMAIL ADDRESS. The call ends at 3:31 with a Thursday,
 *   a half past four, and a promise to send a mail to an address that was never
 *   requested. `slot_named` is the second half of that sentence.
 *
 * The timestamps and segment boundaries are the real call's. The recogniser's
 * habits are kept too — no punctuation, merged turns, a misheard pronoun — since
 * a fixture cleaned up to read well would be a fixture the rules pass against
 * text that never arrives.
 */

export const LOGISTICS_CALL: readonly FixtureLine[] = [
  {
    atMs: 0,
    speakerHint: 'both',
    text: 'hallo guten Tag Becker hier bin ich da richtig bei der Spedition ja da sind Sie richtig guten Tag',
  },
  {
    atMs: 37_000,
    speakerHint: 'both',
    text:
      'ja worum geht es denn ich hab bei Google Ihren Eintrag gesehen und da ist keine Webseite hinterlegt ' +
      'gibt es keine oder ist sie nur nicht verlinkt nee tatsächlich habe ich keine und ich weiß auch nicht ob mir so eine Seite überhaupt was bringt',
  },
  {
    atMs: 47_000,
    speakerHint: 'operator',
    text:
      'was müsste denn eine Webseite für Sie können damit sie Ihnen was bringt oder was muss die Seite machen damit Sie denken die bringt ihn was',
  },
  {
    atMs: 66_000,
    speakerHint: 'business',
    text:
      'na die müsste mir schon Aufträge bringen also dass mich die Leute finden wenn jemand hier in der Gegend nach einer Spedition sucht und nicht die Konkurrenz',
  },
  {
    atMs: 68_000,
    speakerHint: 'business',
    text: 'Umgebung',
  },
  {
    atMs: 117_000,
    speakerHint: 'both',
    text:
      'genau das wäre so das Wichtigste und dass die Seite ein paar Anfragen abfängt weil ich krieg echt viele Anrufe am Tag ' +
      'verstehe da könnte ein Kontaktformular helfen oder eine Seite mit den häufigen Fragen zu Lieferzeiten und Abholung ' +
      'dann müssen Sie nicht jedes Mal selber ans Telefon ja das wär schon was hätten Sie denn grundsätzlich Interesse an einem kurzen Beratungsgespräch',
  },
  {
    atMs: 152_000,
    speakerHint: 'both',
    text:
      'das Gespräch kostet Sie nichts ich zeige Ihnen nur welche Möglichkeiten es gibt und was davon für Sie Sinn macht ' +
      'klingt gut können Sie mir vorher was Schriftliches zukommen lassen damit ich mir das in Ruhe anschauen kann ' +
      'sehr gerne ich schicke Ihnen ein paar Projekte die ich schon umgesetzt habe und dazu noch',
  },
  {
    atMs: 156_000,
    speakerHint: 'operator',
    text: 'ein paar Referenzen',
  },
  {
    atMs: 166_000,
    speakerHint: 'operator',
    text: 'und wie wäre es mit einem Termin nächste Woche das dauert so 20 bis 30 Minuten',
  },
  {
    atMs: 170_000,
    speakerHint: 'operator',
    text: 'höchstens',
  },
  {
    atMs: 189_000,
    speakerHint: 'both',
    text:
      'nächste Woche ist bei mir eher schlecht da sind wir viel auf Tour wann würde es Ihnen denn am besten passen ' +
      'die Woche danach hätte ich Luft gut dann vielleicht am Donnerstag um 15 Uhr',
  },
  {
    atMs: 211_000,
    speakerHint: 'both',
    text:
      'lieber erst um halb fünf halb fünf alles klar dann notiere ich mir das und schicke Ihnen eine Mail mit dem Termin und den Referenzen ' +
      'dann hören wir uns am Donnerstag um halb fünf wunderbar danke Ihnen tschüss',
  },
]
