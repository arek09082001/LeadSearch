/*
 * One cold call, as a microphone on a speakerphone would have heard it.
 *
 * German, because the calls are German and `lang='de-DE'` is what the browser
 * recogniser is set to — a fixture in English would let the surface be built and
 * checked against text that is never going to arrive.
 *
 * WRITTEN AS ONE ROOM, NOT AS TWO SPEAKERS. The lines alternate, but nothing
 * emitted from this file says who is talking: a single microphone hears one
 * stream, and the mock's job is to be indistinguishable from the real thing at
 * the point where it matters. `speakerHint` exists so this file can be read by a
 * human and is deliberately not part of `TranscriptChunk` — see the note on it.
 *
 * The conversation is chosen rather than invented: it walks through four of the
 * triggers in `lib/assistant/vocabulary.ts` — no_time, already_have_someone,
 * price_question and finally buying_signal — so that when the tip provider is
 * wired to this stream in Phase 16 there is something for it to react to. It
 * ends on a callback rather than a sale, because that is what these calls do.
 *
 * The recogniser's own habits are baked in and they are not decoration:
 * no punctuation to speak of, no capitalisation of nouns beyond what the model
 * guesses, numbers as digits, and the occasional word it plainly misheard. A
 * transcript that reads like a screenplay would make the middle column look
 * calmer than it will ever be.
 */

export interface FixtureLine {
  /** Milliseconds from the start of listening, when the line is finished. */
  atMs: number
  /**
   * Who said it — for reading this file, and for nothing else.
   *
   * Never emitted. `TranscriptChunk.speaker` is `unknown` from this provider as
   * it is from the browser one, because the whole point of the mock is to be
   * honest about what a speakerphone can and cannot tell apart.
   */
  speakerHint: 'operator' | 'business'
  text: string
}

export const SPEAKERPHONE_CALL: readonly FixtureLine[] = [
  {
    atMs: 2_400,
    speakerHint: 'business',
    text: 'Elektro Brenner guten Tag',
  },
  {
    atMs: 7_200,
    speakerHint: 'operator',
    text: 'ja guten Tag hier ist Arek Nowak ich habe mir Ihre Webseite angeschaut und da ist mir was aufgefallen haben Sie kurz zwei Minuten',
  },
  {
    atMs: 11_500,
    speakerHint: 'business',
    text: 'ähm ich steh gerade auf der Baustelle was ist denn los',
  },
  {
    atMs: 18_000,
    speakerHint: 'operator',
    text: 'ganz kurz nur Ihre Seite lädt auf dem Handy sehr langsam und im Impressum steht noch 2019 das sehen Ihre Kunden bevor sie anrufen',
  },
  {
    atMs: 24_800,
    speakerHint: 'business',
    text: 'ja das macht mein Neffe das hat der damals gemacht',
  },
  {
    atMs: 31_500,
    speakerHint: 'operator',
    text: 'verstehe das ist ja auch völlig in Ordnung mir geht es gar nicht darum das neu zu bauen sondern nur darum was es Sie kostet wenn jemand vorher abspringt',
  },
  {
    atMs: 38_000,
    speakerHint: 'business',
    text: 'und was soll das dann kosten',
  },
  {
    atMs: 46_500,
    speakerHint: 'operator',
    text: 'das kann ich Ihnen seriös erst sagen wenn ich weiß was Sie brauchen deswegen würde ich Ihnen gern einmal zeigen was ich gemessen habe das dauert zehn Minuten',
  },
  {
    atMs: 52_000,
    speakerHint: 'business',
    text: 'hm und das ist dann kostenlos oder wie',
  },
  {
    atMs: 58_200,
    speakerHint: 'operator',
    text: 'das ist kostenlos ja Sie kriegen die Messung auch wenn Sie danach nichts machen',
  },
  {
    atMs: 64_000,
    speakerHint: 'business',
    text: 'okay und wie läuft das dann ab',
  },
  {
    atMs: 71_500,
    speakerHint: 'operator',
    text: 'ich schicke Ihnen einen Termin per Mail und wir gehen das einmal zusammen durch passt Ihnen Donnerstag Vormittag',
  },
  {
    atMs: 77_000,
    speakerHint: 'business',
    text: 'Donnerstag ist schlecht da bin ich in Kassel',
  },
  {
    atMs: 82_500,
    speakerHint: 'operator',
    text: 'dann Freitag um zehn',
  },
  {
    atMs: 88_000,
    speakerHint: 'business',
    text: 'ja Freitag um zehn können wir machen schicken Sie mir das an info at elektro brenner punkt de',
  },
  {
    atMs: 94_000,
    speakerHint: 'operator',
    text: 'mache ich vielen Dank und bis Freitag',
  },
]
