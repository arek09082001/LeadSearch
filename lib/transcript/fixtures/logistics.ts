import type { FixtureLine } from '@/lib/transcript/fixtures/speakerphone'

/*
 * A REAL CALL. Not written — transcribed, from a run of this tool against a
 * logistics firm in Recklinghausen with a Google listing and no website.
 *
 * It is in the repository because of what it exposed. Under the first version of
 * `TRIGGER_RULES` this entire conversation produced ONE tip, at 2:32, on the word
 * "schriftlich" — and the operator's own verdict on the run was that the tip was
 * right and that there should have been more of them. Every trigger added since
 * is answerable to a moment in this file, which is the only way a phrase list
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
 *   THE OBJECTION IS NOT IN THE LIST. "Ich weiß auch nicht ob eine Website für
 *   mich was bringt" is the first thing this business says, it is the whole call,
 *   and there was no trigger for it. `doubts_the_value` exists because of this
 *   line, and the tip it fires is the move the operator made here by instinct at
 *   0:47 — asking what the site would have to do — which is what turned the call
 *   around and is worth a card on the ones where instinct is elsewhere.
 *
 *   NOBODY ASKED FOR THE EMAIL ADDRESS. The call ends at 3:31 with a Thursday,
 *   a half past four, and a promise to send a mail to an address that was never
 *   requested. `slot_named` is the second half of that sentence.
 *
 * Timestamps are the transcript's own. Spelling and mishearings are left exactly
 * as the recogniser produced them — "was muss deine Uhrzeit machen" is what it
 * wrote, and a fixture cleaned up to read well would be a fixture the rules pass
 * against text that never arrives.
 */

export const LOGISTICS_CALL: readonly FixtureLine[] = [
  {
    atMs: 0,
    speakerHint: 'both',
    text: 'so guten Tag weiß mein Name spreche ich damit Frau weiß ja guten Tag für mich',
  },
  {
    atMs: 37_000,
    speakerHint: 'both',
    text:
      'ja worum geht es denn ich habe mir ihren Business Profil bei Google angeschaut und ich habe gesehen dass sie gar keine Website da verlinkt haben ' +
      'haben sie einfach keine oder ist sie nicht verlinkt also tatsächlich habe ich keine und ich weiß auch nicht ob eine Website für mich was bringt',
  },
  {
    atMs: 47_000,
    speakerHint: 'operator',
    text:
      'was würde denn für sie heißen wenn eine Webseite ihm was bringt oder was muss deine Uhrzeit machen damit sie denken dass sie ihn etwas bringt',
  },
  {
    atMs: 66_000,
    speakerHint: 'business',
    text:
      'also eine Webseiten müsste mir den Vorteil gegenüber anderen verschaffen die keine Website haben dass ich gefunden werde wenn halt jemand nach Logistikunternehmer sucht in meinem Örtchen',
  },
  {
    atMs: 68_000,
    speakerHint: 'business',
    text: 'recklinghausen',
  },
  {
    atMs: 117_000,
    speakerHint: 'both',
    text:
      'und ja das wäre so für mich das Wichtigste und das vielleicht die Website auch Kontaktanfragen abpuffert weil ich kriege sehr viele Anrufe ' +
      'okay ein Kontaktformular auf einer Webseite natürlich oder z.B Anrufe Abhalten von ihnen weil sie sich mehr auf Ihre Arbeit konzentrieren können ' +
      'aber nicht nur Anrufe zu Kontakt nachfragen könnte eine WhatsApp Abfragen sondern soll ich dir auch so normalen Fragen die vielleicht einfach so bestellt werden am Telefon ' +
      'könnten durch Akkus quasi auf der Webseite gut beantwortet werden ja das wäre auch nicht schlecht tatsächlich ja hätten sie da den grundsätzlich Interesse an einem kurzen Beratungsgespräch',
  },
  {
    atMs: 152_000,
    speakerHint: 'both',
    text:
      'das ist komplett kostenlos es entstehen keine Kosten für Sie ich würde ihn einfach nur die Möglichkeiten aufzählen die es gibt und was da vielleicht eventuell für Sie die beste Lösung wäre ' +
      'das können wir gerne machen hätten sie dann vielleicht doch etwas für mich was sie mir schriftlich zu schicken können dass mir dass ich mir das mal was durchlesen kann ' +
      'sehr sehr gerne ich kann ihn aber meine bereits umgesetzten Projekte einmal zu senden und ansonsten könnten ich ihn auch noch so allgemeine',
  },
  {
    atMs: 156_000,
    speakerHint: 'operator',
    text: 'Referenzen zu schicken',
  },
  {
    atMs: 166_000,
    speakerHint: 'operator',
    text: 'ansonsten vielleicht bei ihm nächste Woche aussehen das würde dann so 15 bis 30 Minuten',
  },
  {
    atMs: 170_000,
    speakerHint: 'operator',
    text: 'dauern',
  },
  {
    atMs: 189_000,
    speakerHint: 'both',
    text:
      'ja nächste Woche ist eigentlich eher schlecht bei mir eher schlecht wann würdest du ihn am besten passen ähm in der quasi 42 hätte ich Puffer alles klar passt in Donnerstag 15 Uhr',
  },
  {
    atMs: 211_000,
    speakerHint: 'both',
    text:
      'ja erst 16:30 Uhr 16:30 Uhr alles klar dann will ich dass du festhalten dann schicke ich Ihnen eine E-Mail mit dem Termin und den Referenzen und weitere Informationen ' +
      'und dann hören wir uns am Donnerstag um 16:30 Uhr super vielen Dank auf Wiedersehen ich danke Ihnen',
  },
]
