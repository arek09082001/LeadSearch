/*
 * The assistant's vocabulary: what a tip can be about, and how a call can end.
 *
 * Not `server-only`, for the reason `enrichment/vocabulary.ts` is not: the
 * provider writes these codes and the call surface renders them, and two lists
 * would eventually disagree about what one of them means.
 *
 * TWO VOCABULARIES, AND THEY ARE TREATED DIFFERENTLY ON PURPOSE — the same test
 * the enum migration applies: an enum only where the vocabulary is DECIDED.
 *
 *   TIP_TRIGGERS is closed and mine. A trigger is not something the business
 *   says; it is a situation this tool claims to recognise, and every one of them
 *   has to be recognisable from a transcript and worth interrupting for. Adding
 *   one is a decision, so it is a line here rather than free text.
 *
 *   CALL_OUTCOMES is open, and `calls.outcome` is `text` in the schema to match.
 *   How a call ended is the operator's own shorthand, it will grow with his
 *   habits, and a migration to add "left a voicemail" would be the schema
 *   getting in the way of the work it exists to record.
 */

/* ------------------------------------------------------------------------- *
 * What a tip may interrupt for
 * ------------------------------------------------------------------------- */

export const TIP_TRIGGERS = [
  'no_time',
  'already_have_someone',
  'happy_as_is',
  'price_question',
  'not_the_decider',
  'send_me_an_email',
  'privacy_worry',
  'buying_signal',
  'fully_booked',
  'legal_worry',
  'consent_not_noted',
  'call_running_long',
] as const

export type TipTrigger = (typeof TIP_TRIGGERS)[number]

export interface TipSpec {
  /** Two or three words. What the tip card is titled while it is on screen. */
  label: string
  /**
   * What has to be true for this trigger to fire, in one sentence.
   *
   * Written for the human arguing with the list, not for the model: a trigger
   * whose condition cannot be stated in one sentence is a trigger that will fire
   * on everything, and a tip that fires on everything is noise on a live call.
   */
  when: string
  /**
   * How much this is worth interrupting for. Higher wins.
   *
   * The number that settles a sentence containing three triggers. It is a
   * property of the SITUATION rather than of the phrase that spotted it —
   * "what does it cost" is the same size of moment however it was worded — which
   * is why it lives here beside `when` and not in the rule list.
   *
   * The ordering is an argument, not a scale: a buying signal outranks an
   * objection because an objection survives being answered a minute late and a
   * buying signal does not, and consent outranks everything because it is the
   * only one of these that cannot be put right afterwards.
   */
  weight: number
  /**
   * The tip when the briefing has nothing prepared for this trigger.
   *
   * Bounded by `MAX_TIP_WORDS`, and the bound is checked by the demo script
   * rather than trusted. A standing line is the assistant speaking for itself —
   * true of any call of this kind, argued from nothing this lead was measured on
   * — so it says what to DO and never what is the case. The prepared answer in
   * the briefing is better whenever there is one, and `composeTip` prefers it.
   */
  standing: string
}

/*
 * THE OPERATOR-FACING STRINGS ARE GERMAN AND THE REST OF THIS FILE IS NOT.
 *
 * `label` and `standing` are read off a screen during a German phone call, so
 * they are German. `when` is not: it is the sentence a human argues the list
 * with, and it is also what the model-backed provider is shown so it can file an
 * objection under the right situation — both of those are this codebase talking
 * to itself, and this codebase talks English.
 *
 * THE REGISTER OF A STANDING LINE IS THE TOOL TALKING TO HIM, not him talking to
 * the business. So infinitive or bare imperative, no Sie, no politeness — the
 * shortest form that survives being read mid-sentence. A card that said "Fragen
 * Sie den Kunden bitte, wann..." would be four words of courtesy the operator
 * has to skip past while somebody is waiting for him to answer.
 */
export const TIP_SPECS: Record<TipTrigger, TipSpec> = {
  no_time: {
    label: 'Keine Zeit',
    when: 'They say they are busy, in the middle of something, or ask you to be quick.',
    weight: 35,
    standing: 'Bericht schriftlich anbieten. E-Mail-Adresse holen.',
  },
  already_have_someone: {
    label: 'Hat jemanden',
    when: 'A nephew, an agency or an employee is named as the one who does the website.',
    weight: 45,
    standing: 'Fragen, wann sie zuletzt was von dem gehört haben.',
  },
  happy_as_is: {
    label: 'Läuft doch',
    when: 'They say the site is fine, or that customers find them anyway.',
    weight: 40,
    standing: 'Bitten, die Seite jetzt am Handy aufzumachen.',
  },
  price_question: {
    label: 'Preis',
    when: 'They ask what it costs, before any scope has been agreed.',
    weight: 60,
    standing: 'Nicht beziffern. Fragen, was er sich vorgestellt hat.',
  },
  not_the_decider: {
    label: 'Nicht der Chef',
    when: 'The person on the phone defers to an owner, a partner or a head office.',
    weight: 80,
    standing: 'Namen holen und wann derjenige zu erreichen ist.',
  },
  send_me_an_email: {
    label: 'Schriftlich',
    when: 'They ask for it in writing — which ends the call unless something is agreed first.',
    weight: 65,
    standing: 'Erst einen Termin ausmachen, dann schicken.',
  },
  privacy_worry: {
    label: 'Datenschutz',
    when: 'They ask where you got the number, or how their data is being used.',
    weight: 70,
    standing: 'Öffentlicher Google-Eintrag und die eigene Website. Nüchtern sagen.',
  },
  buying_signal: {
    label: 'Kaufsignal',
    when: 'They ask about timing, next steps, or what it would involve. Stop selling.',
    weight: 90,
    standing: 'Er ist drin. Aufhören zu verkaufen, Termin machen.',
  },
  /*
   * The one where the whole pitch is wrong rather than badly timed.
   *
   * A firm turning work away is not a firm that wants more enquiries, and the
   * argument that lands is the other one the same website carries: the people
   * they cannot hire read it before they apply. Kept apart from `happy_as_is`
   * because the answers are not the same sentence said with more conviction —
   * one asks them to look at their phone, the other changes what is being sold.
   */
  fully_booked: {
    label: 'Ausgebucht',
    when: 'They say they have enough work, are booked out, or are turning jobs away.',
    weight: 50,
    standing: 'Fragen, ob Leute fehlen statt Kunden.',
  },
  /*
   * The imprint finding, coming back the other way.
   *
   * NÜCHTERN, and the standing line is written to hold that line under pressure:
   * the audit measured whether a page exists and what is on it, and it did not
   * measure whether anyone is going to be fined for it. A tip that said "you
   * could be abgemahnt" would be this tool inventing a legal opinion in the one
   * moment the operator is least able to check it.
   */
  legal_worry: {
    label: 'Rechtliches',
    when: 'They raise the imprint, a warning letter or a lawyer.',
    weight: 75,
    standing: 'Nur den Befund nennen. Keine Warnung, keine Rechtsberatung.',
  },
  consent_not_noted: {
    label: 'Einwilligung',
    when: 'The call is being transcribed and consent has not been marked yet.',
    weight: 100,
    standing: 'Sagen, dass mitgeschrieben wird. Dann Haken setzen.',
  },
  call_running_long: {
    label: 'Läuft lang',
    when: 'The call has passed the length at which nothing new gets agreed.',
    weight: 10,
    standing: 'Nächsten Schritt festmachen und auflegen.',
  },
}

export function isTipTrigger(value: string): value is TipTrigger {
  return value in TIP_SPECS
}

/**
 * When a call has gone on long enough that the next minute costs more than it
 * earns.
 *
 * The operator's number, in one place, because two surfaces will want it: the
 * tip that fires on `call_running_long`, and whatever eventually draws a clock
 * on the call screen. Twelve minutes is where a first cold call has either
 * agreed something or is being endured.
 */
export const LONG_CALL_MS = 12 * 60 * 1000

/**
 * How long consent may go unmarked before the assistant says so.
 *
 * Short on purpose. Consent that is remembered at minute nine was not obtained
 * at minute one, and a transcript recorded in between is the single most
 * sensitive thing this database will ever hold.
 */
export const CONSENT_GRACE_MS = 45 * 1000

/* ------------------------------------------------------------------------- *
 * How a call ended
 * ------------------------------------------------------------------------- */

/**
 * The outcomes worth having a name for today. NOT exhaustive, and not a type
 * that anything is allowed to require — `calls.outcome` is free text, and a
 * value not in this list is a shorthand the operator invented, not an error.
 */
export const CALL_OUTCOMES = [
  { key: 'reached', label: 'Reached the business' },
  { key: 'gatekeeper', label: 'Stopped at the gatekeeper' },
  { key: 'no_answer', label: 'Nobody answered' },
  { key: 'voicemail', label: 'Left a voicemail' },
  { key: 'wrong_number', label: 'Wrong number' },
  { key: 'callback', label: 'Callback agreed' },
  { key: 'meeting', label: 'Meeting booked' },
  { key: 'not_interested', label: 'Not interested' },
] as const

export type CallOutcome = (typeof CALL_OUTCOMES)[number]['key']

const OUTCOME_LABELS = new Map<string, string>(
  CALL_OUTCOMES.map((outcome) => [outcome.key, outcome.label]),
)

/** The label, or the raw value for an outcome this build has never heard of. */
export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS.get(outcome) ?? outcome
}
