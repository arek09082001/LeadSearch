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
  // The opening. Everything here happens in the first minute, before there is
  // anything to object to — which is the stretch the first version of this list
  // had nothing at all to say about.
  'what_is_this_about',
  'no_website_confirmed',
  'doubts_the_value',

  // The middle. What they push back with, and — the half that was missing —
  // what they volunteer about their own business while pushing back.
  'no_time',
  'already_have_someone',
  'happy_as_is',
  'price_question',
  'not_the_decider',
  'send_me_an_email',
  'privacy_worry',
  'fully_booked',
  'legal_worry',
  'named_a_need',
  'too_many_calls',

  // The close.
  'buying_signal',
  'slot_named',

  // The two that read the clock instead of the conversation, and the one that
  // reads it at the other end.
  'call_opening',
  'consent_not_noted',
  'call_running_long',
] as const

export type TipTrigger = (typeof TIP_TRIGGERS)[number]

/**
 * The three that fire from the clock rather than from anything said.
 *
 * Named as a set because two things need to agree about them and neither is the
 * matcher. A briefing may not prepare a reply for one — there is nothing to
 * reply to, and `composeTip` would hand back a prepared sentence instead of the
 * standing line the trigger exists for — and the briefing prompt is shown a
 * trigger list with them removed, so the model is not offered a filing category
 * it cannot legitimately use.
 */
export const CLOCK_TRIGGERS = ['call_opening', 'consent_not_noted', 'call_running_long'] as const

/** Everything a briefing objection may be filed under. */
export const PREPARABLE_TRIGGERS: readonly TipTrigger[] = TIP_TRIGGERS.filter(
  (trigger): trigger is TipTrigger => !(CLOCK_TRIGGERS as readonly string[]).includes(trigger),
)

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
  /*
   * The first question of most cold calls, and the one this list used to be
   * silent through.
   *
   * "Worum geht es denn" is not an objection and must not be answered like one.
   * It is a stranger asking for a reason to keep listening, and the answer that
   * works is the one checkable thing that was found — said in a sentence, and
   * then handed straight back as a question. The briefing's `opening` is the
   * prepared form of it and is open in the left column; this fires for the calls
   * where he is asked before he got to say it.
   */
  what_is_this_about: {
    label: 'Worum geht es',
    when: 'They ask who is calling, what this is about, or what you want.',
    weight: 25,
    standing: 'Ein Satz, was aufgefallen ist. Dann eine Frage stellen.',
  },
  /*
   * They confirm there is no website, which is the moment the product is named
   * after and the moment it is easiest to lose.
   *
   * A man who has run a business for twenty years without one has heard the
   * pitch. What has not been asked is how his customers reach him today, and the
   * answer is where every argument worth making comes from — so the tip is a
   * question rather than the start of a case.
   */
  no_website_confirmed: {
    label: 'Keine Website',
    when: 'They confirm they have no website, or that one was never finished.',
    weight: 30,
    standing: 'Nicht verkaufen. Fragen, wie Kunden ihn heute finden.',
  },
  /*
   * "Ich weiß nicht, ob mir eine Website was bringt."
   *
   * THE OBJECTION THIS WHOLE PRODUCT EXISTS UNDER, and the one that cannot be
   * argued with — every argument available here is a claim about their business
   * that nothing measured, which is exactly what `avoid` exists to stop him
   * making. What works is the question back: what would it have to do. It costs
   * nothing to ask, it cannot be contradicted, and the answer is the brief.
   *
   * Kept apart from `happy_as_is`, which is a business that already has one and
   * is content. This is a business that doubts the category.
   */
  doubts_the_value: {
    label: 'Was bringt das',
    when: 'They doubt a website would do anything for them at all.',
    weight: 55,
    standing: 'Zurückfragen: Was müsste sie können, damit sie was bringt?',
  },
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
  /*
   * They say what they would want — and it is the only trigger on this list that
   * fires on something GOOD being said.
   *
   * That is the reason it is here. Every other rule watches for a reason the
   * call is about to end; this one watches for the sentence that decides how it
   * should be sold, and it is the easiest thing on a phone call to hear, agree
   * with, and then talk straight past. "Gefunden werden, wenn jemand in meinem
   * Ort sucht" is a brief. What follows it should be his own words, given back.
   *
   * The tip cannot contain the need — it does not know it, and a tip that quoted
   * the call would put a stranger's sentence in `call_tips`, which outlives the
   * transcript by design. So it says what to DO with it.
   */
  named_a_need: {
    label: 'Sein Kriterium',
    when: 'They say what a website would have to do for them to be worth it.',
    weight: 48,
    standing: 'Wörtlich mitschreiben. Angebot genau daran aufhängen.',
  },
  /*
   * The complaint that is a sale in the wrong clothes.
   *
   * A business drowning in calls is not asking for more enquiries and the pitch
   * that promises them lands as a threat. The same site answers the question
   * instead of forwarding it — a form, the opening hours, the six things that
   * get asked on the phone every week — and that is a different sentence, not
   * the same one said louder. Sits beside `fully_booked` for that reason.
   */
  too_many_calls: {
    label: 'Zu viele Anrufe',
    when: 'They complain about the phone: too many calls, always interrupted.',
    weight: 52,
    standing: 'Formular und Antworten anbieten. Anrufe filtern, nicht mehren.',
  },
  buying_signal: {
    label: 'Kaufsignal',
    when: 'They ask about timing, next steps, or what it would involve. Stop selling.',
    weight: 90,
    standing: 'Er ist drin. Aufhören zu verkaufen, Termin machen.',
  },
  /*
   * They name a day, an hour or a week they can do — and this outranks the
   * buying signal that produced it.
   *
   * The order is an argument. A buying signal survives being answered a minute
   * late; an offered slot does not, because the next thing said either fixes it
   * or lets it pass, and a call that ends on "ich melde mich" has agreed
   * nothing. The second half of the standing line is the one that gets forgotten
   * in practice: an appointment nobody has an address for is not an
   * appointment.
   */
  slot_named: {
    label: 'Termin greifbar',
    when: 'They name when they can, or rule out when they cannot. The close.',
    weight: 95,
    standing: 'Tag und Uhrzeit festnageln. Dann E-Mail-Adresse holen.',
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
  /*
   * The only tip that fires before anybody has said anything worth reacting to.
   *
   * IT IS THE WEAKEST THING ON THE LIST, at weight 5, and that is what makes it
   * safe to have at all: the first real sentence of the call preempts it while
   * it is still on screen. It costs nothing and it is there for the ten seconds
   * in which the operator is most likely to talk too long — the stretch where a
   * cold call is won or lost is the one where he has no prepared answer to lean
   * on, because nothing has been asked yet.
   *
   * IT IS THE SHAPE, NOT THE WORDS. The words are in the briefing's `opening`,
   * open in the left column, written for this lead. A card that repeated them
   * would cost a glance and return nothing — see `composeTip`, which is why this
   * one trigger deliberately never draws from the briefing.
   */
  call_opening: {
    label: 'Einstieg',
    when: 'The line has just opened and nothing has been said yet.',
    weight: 5,
    standing: 'Name, Grund, eine Frage. Dann zuhören.',
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

/**
 * The window in which `call_opening` is worth putting on screen.
 *
 * Both ends are the point. It does not fire at zero because the operator is
 * still saying hello and the card would be up before the line settled; it stops
 * at thirty seconds because a reminder about how to open a call is an insult by
 * the time the call is open, and because a tip that could still arrive at minute
 * two would be one more thing pulling his eye off a conversation that is already
 * running.
 *
 * A call whose first sentence lands inside the window gets a real tip instead —
 * anything on this list preempts weight 5.
 */
export const OPENING_FROM_MS = 4 * 1000
export const OPENING_UNTIL_MS = 30 * 1000

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
