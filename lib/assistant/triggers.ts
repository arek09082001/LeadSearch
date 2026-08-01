import type { Briefing, ShownTip } from '@/lib/assistant/types'
import {
  CONSENT_GRACE_MS,
  LONG_CALL_MS,
  TIP_SPECS,
  type TipTrigger,
} from '@/lib/assistant/vocabulary'

/*
 * What is worth interrupting a phone call for — decided by a list, not a model.
 *
 * THE LOAD-BEARING DECISION OF THIS PHASE IS THAT THE TRIGGER IS NOT A MODEL
 * CALL. Pure, in the sense `findings.ts` is pure: a function of its arguments,
 * no network, no clock beyond the one handed in, no database. Everything that
 * follows is a consequence of it.
 *
 *   NO LATENCY. A tip earned by a sentence at 0:38 that arrives at 0:41 is a tip
 *   about a conversation that has moved on. This runs in the tab, between the
 *   recogniser committing a line and React drawing it, and the operator never
 *   waits for it.
 *
 *   NO COST. `monthly_ceiling_usd` is 0. A model asked to read every sentence of
 *   every call is the single most expensive thing this product could be talked
 *   into, and it would be billed hardest on the calls that go longest — which
 *   are the ones that were going well.
 *
 *   ARGUABLE. When the wrong tip fires, the reason is a line in `TRIGGER_RULES`
 *   and the fix is to edit it. A prompt that started reacting to "kostenlos"
 *   last Tuesday is not a thing anyone can fix between calls.
 *
 * `TipProvider` is not replaced by any of this and is still the interface a
 * Phase 17 model implements. It becomes the EXCEPTION path: what the operator
 * gets when he asks for a tip and no rule had anything. See `manualTip` for the
 * half of that which needs no server at all.
 *
 * ---------------------------------------------------------------------------
 * THE PHRASES ARE GERMAN, AND THEY ARE THE CUSTOMER'S WORDING.
 *
 * German because the calls are German and `lang='de-DE'` is what the recogniser
 * is set to — see `lib/transcript/fixtures/speakerphone.ts`. The tip bodies
 * around them stay English, with the rest of this product's prose and with the
 * briefing replies they are drawn from: the operator reads English on every
 * other surface here, and a card that mixed a German title with an English
 * sentence from the briefing would be worse than either.
 *
 * The customer's wording is the harder constraint and it is not a style note.
 * ONE MICROPHONE ON A SPEAKERPHONE HEARS ONE ROOM: `TranscriptSegment.speaker`
 * is `unknown` on every line this surface writes, and no rule here can tell the
 * two voices apart. So a phrase that the OPERATOR says will fire a tip at him
 * about his own sentence. The fixture call is the proof and was used as one:
 *
 *   "…nur darum was es Sie kostet wenn jemand vorher abspringt"   (operator)
 *   "…und was soll das dann kosten"                               (business)
 *
 * Both contain "kost". Only the second is a price question. Hence `was kostet`
 * and `was soll das kosten` rather than `kosten`, hence `schicken sie mir`
 * rather than `per mail` — the operator offers to send things constantly — and
 * hence `abmahnung` rather than `impressum`, because naming the imprint finding
 * is what the operator does for a living and raising it is what a worried
 * customer does. Every rule below has been checked against the operator's lines
 * in that fixture, and the demo script re-checks it.
 * ---------------------------------------------------------------------------
 */

/* ------------------------------------------------------------------------- *
 * The bounds
 * ------------------------------------------------------------------------- */

/**
 * The hard limit on a tip, in words. Enforced here, not requested of a provider.
 *
 * Twelve is what can be taken in without stopping the sentence you are already
 * saying. It is enforced in code because the alternative — asking politely for
 * brevity in a prompt — is a layout that a model can push around during a phone
 * call, and it would push it around on exactly the calls where it had most to
 * say.
 */
export const MAX_TIP_WORDS = 12

/** How long a tip stays up before it takes itself away. */
export const TIP_HOLD_MS = 20_000

/**
 * The quiet after a tip, before an equal or weaker one may follow.
 *
 * A single German sentence can carry three triggers — the fixture's "das macht
 * mein Neffe das hat der damals gemacht" carries two on its own — and three
 * cards stacking is the assistant shouting. The gap is what makes it speak once.
 *
 * NOT A HARD MUTE, and that exception is the point of having weights at all: a
 * stronger situation preempts a weaker one that is still on screen. Being told
 * about a nephew must never be the reason a buying signal is missed.
 */
export const TIP_GAP_MS = TIP_HOLD_MS

/* ------------------------------------------------------------------------- *
 * Getting a spoken line into a shape a fixed phrase can be found in
 * ------------------------------------------------------------------------- */

/**
 * Words a recogniser writes down and a listener does not hear.
 *
 * Dropped before matching, and this is what makes a phrase list viable at all
 * against speech. "und was soll das dann kosten" is the fixture's actual line;
 * `was soll das kosten` is the rule. Nothing but a filler stands between them,
 * and a list that had to enumerate every position a "dann" can occupy would be
 * a list nobody could maintain.
 *
 * Kept deliberately short. Every word here is one the matcher becomes blind to,
 * so it holds only particles that carry no meaning on their own — "so" is
 * absent because "läuft auch so" needs it, and "nicht" will never be added.
 */
const FILLERS = new Set([
  'ähm',
  'äh',
  'ähem',
  'hm',
  'hmm',
  'öh',
  'ja',
  'also',
  'halt',
  'eigentlich',
  'mal',
  'denn',
  'dann',
  'nun',
  'quasi',
  'sozusagen',
])

/**
 * Lower case, no punctuation, no umlauts, no fillers, single spaces.
 *
 * Applied to the transcript and to the rule phrases both, so the phrases can be
 * written in readable German and still match. The umlaut folding is not
 * cosmetic: a recogniser that returns "auftraege" or "Auftrage" for "Aufträge"
 * is a normal Tuesday, and a rule that only matched the correctly-accented form
 * would fail silently and look like a missing rule rather than a spelling one.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[äàáâ]/g, 'a')
    .replace(/[öòóô]/g, 'o')
    .replace(/[üùúû]/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !FILLERS.has(word))
    .join(' ')
}

/* ------------------------------------------------------------------------- *
 * The list
 * ------------------------------------------------------------------------- */

interface TriggerRule {
  trigger: TipTrigger
  /**
   * Any one of these, heard in a line, fires the rule.
   *
   * Substrings of the normalised line rather than patterns, for the reason the
   * fixtures give for their own cues: a regex in this list is the beginning of
   * a rule nobody can read, and an unreadable rule is one that stays wrong.
   */
  phrases: string[]
}

/**
 * Every situation this tool claims to recognise from what was said.
 *
 * The order is irrelevant to the outcome — `matchTriggers` returns all of them
 * and `TipSpec.weight` settles which wins — so this is grouped for reading.
 */
const TRIGGER_RULES: TriggerRule[] = [
  {
    trigger: 'no_time',
    phrases: [
      'keine zeit',
      'steh gerade',
      'stehe gerade',
      'bin gerade',
      'mitten in',
      'auf der baustelle',
      'machen sie schnell',
      'muss gleich weiter',
      'hab kunden',
      'habe kunden',
      'ganz schlecht gerade',
      'ungunstig',
      'passt gerade nicht',
    ],
  },
  {
    /*
     * The nephew. The most common answer in this trade and the one most easily
     * mishandled: it is not an objection to the work, it is a relationship, and
     * a tip that argued with the nephew would cost the call.
     */
    trigger: 'already_have_someone',
    phrases: [
      'neffe',
      'macht mein',
      'macht meine',
      'damals gemacht',
      'jemand gemacht',
      'hat mir jemand',
      'ein bekannter',
      'unsere agentur',
      'eine agentur',
      'haben wir jemanden',
      'kummert sich jemand',
      'webmaster',
      'macht der sohn',
    ],
  },
  {
    trigger: 'happy_as_is',
    phrases: [
      'lauft auch so',
      'lauft gut',
      'brauch ich nicht',
      'brauche ich nicht',
      'brauchen wir nicht',
      'hab ich schon',
      'habe ich schon',
      'haben wir schon',
      'haben wir bereits',
      'ist in ordnung so',
      'passt schon',
      'sind zufrieden',
      'beschwert sich keiner',
      'hat sich keiner beschwert',
      'kein bedarf',
    ],
  },
  {
    trigger: 'price_question',
    phrases: [
      'was kostet',
      'was soll das kosten',
      'was wurde das kosten',
      'was wurde mich das kosten',
      'wie teuer',
      'zu teuer',
      'preislich',
      'was verlangen sie',
      'was nehmen sie',
      'was kommt da auf mich zu',
    ],
  },
  {
    trigger: 'not_the_decider',
    phrases: [
      'mein chef',
      'der chef',
      'mein mann',
      'meine frau',
      'der inhaber',
      'die inhaberin',
      'die zentrale',
      'nicht meine entscheidung',
      'da mussen sie mit',
      'muss ich mit meinem',
      'bin nur die',
      'bin nur der',
    ],
  },
  {
    trigger: 'send_me_an_email',
    phrases: [
      'schicken sie mir',
      'schicken sie mal',
      'schicken sie das',
      'schriftlich',
      'melden sie sich',
      'unterlagen',
      'per post',
    ],
  },
  {
    trigger: 'privacy_worry',
    phrases: [
      'woher haben sie',
      'wo haben sie meine',
      'wer hat ihnen',
      'meine daten',
      'unsere daten',
      'dsgvo',
      'datenschutz',
      'wie kommen sie an',
    ],
  },
  {
    trigger: 'buying_signal',
    phrases: [
      'wie lauft das ab',
      'wie geht es weiter',
      'was brauchen sie von mir',
      'wann konnten sie',
      'wann hatten sie',
      'was musste ich',
      'zeigen sie mir',
      'wie schnell geht',
      'nachster schritt',
      'was wurde das bringen',
    ],
  },
  {
    trigger: 'fully_booked',
    phrases: [
      'ausgebucht',
      'genug auftrage',
      'genug zu tun',
      'voll ausgelastet',
      'ausgelastet',
      'kommen nicht hinterher',
      'komme nicht hinterher',
      'brauchen keine neuen kunden',
      'brauche keine kunden',
      'finden keine leute',
      'finde keine leute',
      'keine mitarbeiter',
      'suchen leute',
    ],
  },
  {
    /*
     * Note what is NOT here: a bare `impressum`. The operator says that word in
     * the fixture at 0:18 while reading a finding aloud, and a rule matching it
     * would answer his own diagnosis back to him as legal advice.
     */
    trigger: 'legal_worry',
    phrases: [
      'abmahnung',
      'abgemahnt',
      'anwalt',
      'rechtlich',
      'impressum ist',
      'impressum stimmt',
      'mit dem impressum',
      'muss das rein',
    ],
  },
]

/* ------------------------------------------------------------------------- *
 * Matching
 * ------------------------------------------------------------------------- */

export interface TriggerMatch {
  trigger: TipTrigger
  /**
   * The rule that fired, or null for the two that read the clock instead.
   *
   * Carried so that "why did that appear" has an answer at a terminal. Nothing
   * on screen shows it and no column stores it — a stored phrase would be a
   * fragment of what a stranger said, sitting in a table that never expires,
   * which is precisely what `call_tips` promises not to hold.
   */
  phrase: string | null
  /** From `TIP_SPECS`. Higher wins. */
  weight: number
  /** Where in the call this was heard. */
  atMs: number
}

export interface TriggerContext {
  /** Where the call is now, in milliseconds since it started. */
  atMs: number
  /** From `calls.consent_noted`. The input `consent_not_noted` exists to read. */
  consentNoted: boolean
}

/**
 * Everything the given line is, strongest first.
 *
 * Returns ALL matches rather than the best one, because the caller is the only
 * thing that knows what is already on screen — and a function that picked a
 * winner before dedupe would hide the second-strongest trigger of a sentence
 * whose strongest had already been shown a minute ago.
 *
 * The two state triggers are here rather than in the component for the same
 * reason the phrase rules are: a rule that fires from the clock is still a rule,
 * and half the trigger list living in a React file is how the other half stops
 * being maintained. They do not read `text`, so passing an empty string is the
 * supported way to ask "is anything true right now" while nobody is speaking.
 */
export function matchTriggers(text: string, context: TriggerContext): TriggerMatch[] {
  const matches: TriggerMatch[] = []
  const heard = normalise(text)

  if (heard) {
    for (const rule of TRIGGER_RULES) {
      const phrase = rule.phrases.find((candidate) => heard.includes(normalise(candidate)))
      if (!phrase) continue
      matches.push({
        trigger: rule.trigger,
        phrase,
        weight: TIP_SPECS[rule.trigger].weight,
        atMs: context.atMs,
      })
    }
  }

  /*
   * Consent, which outranks every sentence in the call.
   *
   * A recording made without a word said about it cannot be un-made by noticing
   * two minutes later, and the operator mid-conversation is the last person who
   * will remember on his own. The grace period is what keeps it from firing
   * over the greeting, when he is about to say it anyway.
   */
  if (!context.consentNoted && context.atMs >= CONSENT_GRACE_MS) {
    matches.push({
      trigger: 'consent_not_noted',
      phrase: null,
      weight: TIP_SPECS.consent_not_noted.weight,
      atMs: context.atMs,
    })
  }

  // And the clock, which outranks nothing. A call that is going somewhere at
  // minute thirteen should not be interrupted to be told that it is long.
  if (context.atMs >= LONG_CALL_MS) {
    matches.push({
      trigger: 'call_running_long',
      phrase: null,
      weight: TIP_SPECS.call_running_long.weight,
      atMs: context.atMs,
    })
  }

  return matches.sort((a, b) => b.weight - a.weight)
}

/* ------------------------------------------------------------------------- *
 * From a trigger to twelve words
 * ------------------------------------------------------------------------- */

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

/**
 * The first part of a prepared reply that fits on a card.
 *
 * CUTS NOTHING THAT ALREADY FITS. A line inside the bound is returned whole,
 * which is what keeps a two-sentence instruction from arriving as one: "Do not
 * quote. Ask what they have in mind." is nine words and both halves are the
 * point, and a rule that always took the first sentence would file the second
 * one off every standing line in the vocabulary.
 *
 * Only when it does not fit does this split — on sentence ends and on the em
 * dash — and then it takes THE FIRST unit that fits. First rather than longest,
 * and that is the whole of the rule: a briefing reply is written as a sequence
 * of moves and its opening move is the one to make. Picking the longest
 * fragment that happened to fit would reorder the operator's own argument on
 * his behalf.
 *
 * Nothing is lost by cutting: the full reply is in the briefing column on the
 * left, open, for the length of the call. This is a nudge, not a script.
 *
 * When no unit fits, the first is cut to the bound and marked with an ellipsis
 * — visibly truncated rather than quietly reworded, so a reply that needs
 * rewriting looks like one.
 */
export function condense(text: string, maxWords: number = MAX_TIP_WORDS): string {
  const whole = text.trim()
  if (words(whole).length <= maxWords) return whole

  const units = whole
    .split(/(?<=[.!?])\s+|\s+—\s+/)
    .map((unit) => unit.trim())
    .filter(Boolean)

  for (const unit of units) {
    if (words(unit).length <= maxWords) return unit
  }

  const first = words(units[0] ?? text)
  return `${first.slice(0, maxWords).join(' ')}…`
}

/**
 * Where a tip's words came from.
 *
 * `provider` is never produced by this file — nothing here calls anything — but
 * it is named here because this is where the vocabulary of a tip lives, and a
 * surface that had to invent a label for the answer that came back from `ask`
 * would end up filing it under `briefing` and quietly losing the distinction
 * that matters most: whether a model was involved.
 */
export type TipSource = 'briefing' | 'standing' | 'provider'

export interface LiveTip {
  trigger: TipTrigger
  /** At most `MAX_TIP_WORDS` words. Guaranteed here rather than downstream. */
  body: string
  /** Where the words came from. Not stored; it decides nothing, it explains. */
  source: TipSource
  atMs: number
}

/**
 * The words for a trigger: the prepared answer if there is one, else the
 * standing line.
 *
 * `BriefingObjection.trigger` is the join, and it is the field's whole purpose —
 * "the live trigger this is the prepared form of". So an objection the operator
 * already has on screen, written against THIS lead's findings, beats a general
 * instruction every time it exists. The standing line in `TIP_SPECS` covers the
 * rest, including the two triggers no briefing can ever prepare for.
 *
 * Briefing POINTS are deliberately not a source. They are facts, not moves —
 * "PageSpeed 23" is an argument to make, not a thing to do — and they are
 * already open in the left column where they can be read in full. Compressing
 * one into a twelve-word imperative would mean this function writing prose,
 * which is the job it exists to avoid.
 */
export function composeTip(
  trigger: TipTrigger,
  briefing: Briefing | null,
): { body: string; source: TipSource } {
  const prepared = briefing?.objections.find((objection) => objection.trigger === trigger)

  if (prepared?.reply) {
    return { body: condense(prepared.reply), source: 'briefing' }
  }

  return { body: condense(TIP_SPECS[trigger].standing), source: 'standing' }
}

/* ------------------------------------------------------------------------- *
 * Which one, if any, gets the screen
 * ------------------------------------------------------------------------- */

export interface LiveTipContext extends TriggerContext {
  /** The briefing on screen, when there is one. The source of the good tips. */
  briefing: Briefing | null
  /** Every tip already shown in this call. A trigger fires once per call. */
  shown: readonly ShownTip[]
  /** When the last tip went up, for the gap. Null when none has. */
  lastShownAtMs: number | null
  /** The weight of the tip last shown, for the preemption rule. */
  lastShownWeight: number | null
}

/**
 * One tip, or silence — and silence is the answer most of the time.
 *
 * Three filters, in this order, and each is a decision about noise:
 *
 *   1. ONCE PER CALL per trigger. Being told twice what to do about a price
 *      question is being told nothing; the second card only costs a glance.
 *      This is the same contract `TipContext.alreadyShown` states for the
 *      provider, applied to the rules so both paths behave alike.
 *
 *   2. THE GAP, so a sentence carrying three triggers does not stack three
 *      cards. The strongest is the one that survives.
 *
 *   3. PREEMPTION, which is the gap's one exception: a stronger situation may
 *      interrupt a weaker card that is still up. Without it the gap would make
 *      the assistant miss buying signals in order to finish telling the operator
 *      about a nephew, and missing those is the only failure here that costs a
 *      sale rather than a glance.
 */
export function nextTip(text: string, context: LiveTipContext): LiveTip | null {
  const seen = new Set(context.shown.map((entry) => entry.trigger))

  for (const match of matchTriggers(text, context)) {
    if (seen.has(match.trigger)) continue

    const since =
      context.lastShownAtMs === null ? Number.POSITIVE_INFINITY : context.atMs - context.lastShownAtMs

    if (since < TIP_GAP_MS && match.weight <= (context.lastShownWeight ?? 0)) continue

    const { body, source } = composeTip(match.trigger, context.briefing)
    return { trigger: match.trigger, body, source, atMs: match.atMs }
  }

  return null
}

/**
 * What to say when he asked and no rule had fired — without leaving the tab.
 *
 * The next objection the briefing prepared and the call has not used yet. It is
 * not a guess about the conversation and does not pretend to be one: the
 * operator pressed a key because he wanted something, and the honest cheapest
 * answer is the strongest prepared line he has not reached for.
 *
 * The model path is still `TipProvider`, still reached over a route, and still
 * the exception. This is what runs when it returns null — which, with the
 * fixture-backed mock reading English cues off a German call, is most of the
 * time. Ordering follows the briefing's own: it was written worst-first.
 */
export function manualTip(
  briefing: Briefing | null,
  shown: readonly ShownTip[],
  atMs: number,
): LiveTip | null {
  if (!briefing) return null

  const seen = new Set(shown.map((entry) => entry.trigger))

  for (const objection of briefing.objections) {
    if (!objection.trigger || seen.has(objection.trigger)) continue
    return {
      trigger: objection.trigger,
      body: condense(objection.reply),
      source: 'briefing',
      atMs,
    }
  }

  return null
}
