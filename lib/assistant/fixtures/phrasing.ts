import type { BriefingFinding, BriefingInput } from '@/lib/assistant/types'

/*
 * The phrase inventory the mock provider answers from.
 *
 * Until the model phase there is no model call in this product, and every
 * external capability sits behind an interface with a fixture-backed
 * implementation behind it. This is that fixture set: a fixed inventory of
 * sentences, chosen by rules that are readable in one sitting.
 *
 * WHY THE HOOK LINES ARE HERE AND NOT TAKEN FROM `findings.ts`. The audit's own
 * sentences are excellent and they are what the provider is GIVEN — see
 * `briefing-input.ts`, which carries every one of them through verbatim. But
 * they are written about the business, in the third person, for the operator to
 * read on a page: "the business does not own the address it prints on its van".
 * A hook is the thing he says to the owner's face, and it is one sentence.
 * Those are two different jobs, and a file that tried to do both would do the
 * second one badly. The audit's phrasing stays the source of truth for WHAT is
 * wrong; this file only decides how it is said down a telephone.
 *
 * The fallback matters as much as the entries: a code with no line here falls
 * back to the audit's own first sentence, so a new check is briefable the day it
 * ships, in the audit's words, rather than silently missing from every briefing
 * until somebody remembers this file.
 */

/* ------------------------------------------------------------------------- *
 * Reading the evidence back
 * ------------------------------------------------------------------------- */

/**
 * One recorded measurement, by the label `briefing-input.ts` gave it.
 *
 * Deliberately by label rather than by the checker's original key: the input is
 * what a provider sees, and a fixture that reached behind it into the raw
 * evidence would be reading something the interface does not promise.
 */
export function evidenceValue(finding: BriefingFinding, label: string): string | null {
  return finding.evidence.find((pair) => pair.label === label)?.value ?? null
}

/* ------------------------------------------------------------------------- *
 * Hooks — one sentence, said to the owner
 * ------------------------------------------------------------------------- */

export const HOOK_LINES: Record<string, (finding: BriefingFinding) => string> = {
  no_website: () =>
    'Anyone who looks you up on Google finds a pin and a phone number and nothing behind it.',
  social_only: () =>
    'Your whole presence online is a page you do not own, on a platform that decides what sits next to it.',
  dead_domain: () =>
    'The web address printed on your van and your invoices no longer leads anywhere at all.',
  site_unreachable: () => 'Your site did not answer at all when I tried it before calling.',
  http_error: (finding) => {
    const status = evidenceValue(finding, 'http status')
    return status
      ? `Anyone following the link from Google gets an error screen — HTTP ${status} instead of your page.`
      : 'Anyone following the link from Google gets an error screen instead of your page.'
  },
  no_https: () =>
    'Chrome puts “Not secure” in the address bar before a visitor has read a word of your site.',
  invalid_certificate: (finding) => {
    const months = evidenceValue(finding, 'expired months ago')
    return months
      ? `Your security certificate ran out ${months} months ago, so every visitor now clicks through a full-page red warning to reach you.`
      : 'Every visitor now clicks through a full-page security warning before they reach your site.'
  },
  no_imprint: () =>
    'There is no Impressum on the site, which is the one page German law is specific about.',
  imprint_incomplete: () =>
    'The Impressum is there, but it does not name everything §5 TMG asks it to.',
  no_privacy_policy: () => 'There is no privacy policy linked anywhere on the site.',
  insecure_contact_form: () =>
    'Your contact form collects names and numbers on a page that is not encrypted.',
  external_fonts_cdn: () =>
    'The site hands every visitor’s IP address to Google before anything has appeared on screen.',
  embedded_maps_no_consent: () =>
    'A Google Maps frame loads on your page before the visitor has agreed to anything.',
  no_vat_id: () => 'The Impressum states no VAT number.',
  not_mobile_friendly: () =>
    'On a phone your site comes up at desktop width, so people pinch and drag to read it.',
  psi_poor: (finding) => {
    const score = evidenceValue(finding, 'score')
    return score
      ? `Google’s own mobile speed test gives your site ${score} out of 100 — you can run it yourself in a minute.`
      : 'Google’s own mobile speed test fails your site outright.'
  },
  psi_weak: (finding) => {
    const score = evidenceValue(finding, 'score')
    return score
      ? `Google’s own mobile speed test scores your site ${score} out of 100.`
      : 'Google’s own mobile speed test scores your site poorly.'
  },
  poor_lcp: (finding) => {
    const lcp = evidenceValue(finding, 'lcp ms')
    const seconds = lcp ? (Number(lcp) / 1000).toFixed(1) : null
    return seconds && Number.isFinite(Number(seconds))
      ? `On a phone it takes ${seconds} seconds before the main thing on the page shows up.`
      : 'On a phone it takes several seconds before the main thing on the page shows up.'
  },
  layout_shift: () =>
    'The page keeps moving under the reader’s thumb while it is still loading.',
  slow_response: (finding) => {
    const ms = evidenceValue(finding, 'load ms')
    const seconds = ms ? (Number(ms) / 1000).toFixed(1) : null
    return seconds && Number.isFinite(Number(seconds))
      ? `Your server takes ${seconds} seconds just to hand the page over, before a single image starts loading.`
      : 'Your server takes seconds just to hand the page over, before a single image starts loading.'
  },
  outdated_wordpress: (finding) => {
    const version = evidenceValue(finding, 'version')
    return version
      ? `The site runs WordPress ${version}, which stopped getting security fixes years ago — and the version number is readable by anyone.`
      : 'The WordPress behind the site stopped getting security fixes years ago.'
  },
  free_subdomain: () =>
    'The address is a free subdomain on somebody else’s platform, so you cannot take it with you.',
  diy_platform: () =>
    'The site was put together on a drag-and-drop builder, and it reads like one next to your competitors.',
  dated_markup: () =>
    'The page is still built the way sites were built around 2010, which is why it looks the way it does.',
  stale_copyright: (finding) => {
    const year = evidenceValue(finding, 'copyright year')
    return year
      ? `Your footer still says © ${year}, and that is the first thing a customer checks to see whether you are still trading.`
      : 'Your footer is years out of date, which is what a customer checks to see whether you are still trading.'
  },
  no_title: () =>
    'Your page has no title, so the browser tab and every Google result show a bare web address instead of your name.',
  no_meta_description: () =>
    'Google writes the description under your listing itself, because the page gives it none.',
  no_favicon: () =>
    'There is no icon in the browser tab, so a bookmark of your site is a blank sheet of paper.',
}

/**
 * The fallback: the audit's own opening sentence.
 *
 * Kept to one sentence because that is what a hook is. A message with no full
 * stop in it comes back whole — the audit never writes one that long, and
 * truncating on a character count would cut a claim in half, which is worse
 * than a slightly long line.
 */
export function firstSentence(message: string): string {
  const end = message.indexOf('. ')
  return end === -1 ? message.trim() : message.slice(0, end + 1).trim()
}

/* ------------------------------------------------------------------------- *
 * Evidence — the numbers he says out loud
 * ------------------------------------------------------------------------- */

/**
 * A fault turned into one checkable figure, or nothing.
 *
 * Nothing is a real answer and the common one: "the page has no title" is a
 * fact, not a figure, and padding this list with facts that carry no number
 * would defeat what it is for. What belongs here is what survives being
 * repeated back — "twenty-three out of a hundred" — and what the owner can go
 * and verify after the call.
 */
export const EVIDENCE_LINES: Record<
  string,
  (finding: BriefingFinding) => { label: string; value: string } | null
> = {
  psi_poor: (finding) => {
    const score = evidenceValue(finding, 'score')
    return score ? { label: 'PageSpeed, mobile', value: `${score} of 100` } : null
  },
  psi_weak: (finding) => {
    const score = evidenceValue(finding, 'score')
    return score ? { label: 'PageSpeed, mobile', value: `${score} of 100` } : null
  },
  poor_lcp: (finding) => {
    const lcp = evidenceValue(finding, 'lcp ms')
    if (!lcp || !Number.isFinite(Number(lcp))) return null
    return { label: 'Main content appears after', value: `${(Number(lcp) / 1000).toFixed(1)}s` }
  },
  slow_response: (finding) => {
    const ms = evidenceValue(finding, 'load ms')
    if (!ms || !Number.isFinite(Number(ms))) return null
    return { label: 'Server hands over the page in', value: `${(Number(ms) / 1000).toFixed(1)}s` }
  },
  layout_shift: (finding) => {
    const cls = evidenceValue(finding, 'cls')
    return cls ? { label: 'Layout shift', value: `${cls} — Google calls 0.25 poor` } : null
  },
  stale_copyright: (finding) => {
    const year = evidenceValue(finding, 'copyright year')
    return year ? { label: 'Footer still says', value: `© ${year}` } : null
  },
  outdated_wordpress: (finding) => {
    const version = evidenceValue(finding, 'version')
    return version ? { label: 'WordPress', value: version } : null
  },
  invalid_certificate: (finding) => {
    const months = evidenceValue(finding, 'expired months ago')
    return months ? { label: 'Certificate expired', value: `${months} months ago` } : null
  },
  http_error: (finding) => {
    const status = evidenceValue(finding, 'http status')
    return status ? { label: 'Server answers', value: `HTTP ${status}` } : null
  },
  no_imprint: () => ({ label: 'Impressum', value: 'none found' }),
  imprint_incomplete: () => ({ label: 'Impressum', value: 'incomplete' }),
  no_privacy_policy: () => ({ label: 'Privacy policy', value: 'none linked' }),
  no_website: () => ({ label: 'Website on Google', value: 'none' }),
}

/* ------------------------------------------------------------------------- *
 * Objections
 * ------------------------------------------------------------------------- */

/**
 * The facts every predicate below is written against.
 *
 * Assembled once so a fixture asks `facts.failed.has('no_website')` rather than
 * walking two arrays, and so adding an objection is a matter of writing two
 * sentences and one condition.
 */
export interface BriefingFacts {
  input: BriefingInput
  /** Every failed code, technical and compliance together. */
  failed: Set<string>
  /** Every check the site passed. What the `avoid` list is built from. */
  passed: Set<string>
  /** True when nobody has ever rung, written or visited. */
  firstContact: boolean
}

export function factsOf(input: BriefingInput): BriefingFacts {
  return {
    input,
    failed: new Set([...input.faults, ...input.compliance].map((finding) => finding.code)),
    passed: new Set(input.passed.map((entry) => entry.code)),
    firstContact: input.history.attempts === 0,
  }
}

/** "once", "twice", "four times" — said aloud, not counted off a row. */
function countedTimes(count: number): string {
  if (count === 1) return 'once'
  if (count === 2) return 'twice'
  return `${count} times`
}

export interface ObjectionFixture {
  key: string
  objection: string
  answer: (facts: BriefingFacts) => string
  /** True when this owner is plausibly going to say it. */
  applies: (facts: BriefingFacts) => boolean
  /**
   * Ordering among those that apply, high first.
   *
   * Not a probability — nobody has measured one. It is the operator's ranking of
   * which objection ends a call if it is not answered well, which is the only
   * thing worth optimising a list of three for.
   */
  rank: number
}

export const OBJECTIONS: ObjectionFixture[] = [
  {
    key: 'where_did_you_get_my_number',
    objection: 'Where did you get my number?',
    answer: (facts) =>
      facts.input.business.phone
        ? 'From your own Google listing — the same place your customers get it. That is where I looked at your web presence too.'
        : 'From your own public listing. That is where I looked at your web presence too.',
    applies: (facts) => facts.firstContact,
    rank: 60,
  },
  {
    key: 'we_have_a_website',
    objection: 'We already have a website.',
    /*
     * Deliberately names no fault. The obvious version spliced the worst
     * finding's label into the sentence and produced "Runs an unsupported
     * WordPress, and that is what I am calling about" — the labels are noun
     * phrases written for a table column and they do not survive being dropped
     * into speech. The hook list directly above this on the sheet is where the
     * fault is named, in a sentence built to be said.
     */
    answer: () =>
      'You do — I looked at it before ringing. What I am calling about is what is on it, not whether it exists.',
    applies: (facts) => Boolean(facts.input.business.website) && !facts.failed.has('no_website'),
    rank: 90,
  },
  {
    key: 'no_website_on_purpose',
    objection: 'We do not need a website, everything comes by phone.',
    answer: (facts) =>
      facts.input.business.rating !== null && facts.input.business.reviewCount
        ? `Your ${facts.input.business.rating} from ${facts.input.business.reviewCount} reviews says people are already looking you up. Right now what they find is a pin, and the next name on the list has a page.`
        : 'The calls you get are from people who already know the name. It is the ones who do not that end up on a competitor’s page.',
    applies: (facts) => facts.failed.has('no_website') || facts.failed.has('social_only'),
    rank: 95,
  },
  {
    key: 'word_of_mouth',
    objection: 'We get all our work by word of mouth.',
    answer: () =>
      'That is usually true, and it is the argument for this rather than against it: the person you were recommended to looks you up before they ring, and that is the moment I am talking about.',
    applies: () => true,
    rank: 50,
  },
  {
    key: 'nephew_built_it',
    objection: 'My nephew built it for us.',
    answer: () =>
      'Then he did you a favour and it has been left standing since. I am not proposing to criticise it — I am proposing to take it off his plate.',
    applies: (facts) => facts.failed.has('diy_platform') || facts.failed.has('free_subdomain'),
    rank: 70,
  },
  {
    key: 'it_works_fine',
    objection: 'It works fine.',
    answer: (facts) => {
      const psi = facts.input.faults.find(
        (finding) => finding.code === 'psi_poor' || finding.code === 'psi_weak',
      )
      const score = psi ? evidenceValue(psi, 'score') : null
      return score
        ? `It works on your machine. Google scores it ${score} out of 100 on a phone, and you can run that test yourself in a minute — it is Google’s number, not mine.`
        : 'It works on your machine, on a fast connection, from the cache. The test I ran is Google’s own, and you can run it yourself in a minute.'
    },
    applies: (facts) =>
      facts.failed.has('psi_poor') ||
      facts.failed.has('psi_weak') ||
      facts.failed.has('poor_lcp') ||
      facts.failed.has('slow_response'),
    rank: 80,
  },
  {
    key: 'not_required',
    objection: 'Nobody needs an Impressum for a small business like ours.',
    answer: () =>
      '§5 TMG applies from the first commercial page, and it is the cheapest thing on this list to fix. I mention it because a competitor is the one who usually reports it, not a customer.',
    applies: (facts) => facts.failed.has('no_imprint') || facts.failed.has('imprint_incomplete'),
    rank: 75,
  },
  {
    key: 'too_expensive',
    objection: 'We have no budget for that.',
    answer: () =>
      'Then let us not start there. Tell me what you would want it to do, and I will tell you what the smallest version of that costs — if the number is wrong, it is wrong in one phone call rather than after a proposal.',
    applies: () => true,
    rank: 55,
  },
  {
    key: 'send_an_email',
    objection: 'Send me something by email.',
    answer: (facts) =>
      facts.input.business.website
        ? 'I will, gladly. Two minutes now decides what is in it — otherwise I am sending you a template and you are deleting it.'
        : 'I will, gladly. Give me two minutes now so what I send is about your business rather than a template.',
    applies: () => true,
    rank: 45,
  },
  {
    key: 'called_before',
    objection: 'You have called about this before.',
    answer: (facts) =>
      `I have — ${countedTimes(facts.input.history.attempts)}, and I said I would come back. Something has changed since then, which is why this is not the same call.`,
    applies: (facts) => !facts.firstContact,
    rank: 85,
  },
  {
    key: 'we_are_busy',
    objection: 'We are booked out as it is.',
    answer: () =>
      'Then this is not about more work — it is about the kind. A page that says what you do and what you charge is how you stop fielding the enquiries you do not want.',
    applies: () => true,
    rank: 40,
  },
  {
    key: 'facebook_is_enough',
    objection: 'We are on Facebook, that is enough.',
    answer: () =>
      'It is a start, and it is rented. Facebook decides who sees it, what sits beside it, and whether the page is there next year — and none of it shows up when somebody searches your trade and your town.',
    applies: (facts) => facts.failed.has('social_only'),
    rank: 88,
  },
]

/* ------------------------------------------------------------------------- *
 * What not to say
 * ------------------------------------------------------------------------- */

/**
 * The claim a passing check makes impossible.
 *
 * Only the checks somebody would actually be tempted to open with. A briefing
 * that listed every passing criterion would be a second diagnosis, and the
 * operator would stop reading the list at the point it stopped surprising him —
 * which is exactly where the useful entries are.
 *
 * THE ORDER IS LOAD-BEARING. Only the first few that apply are shown, and they
 * are taken in the order written here rather than in the order the audit
 * happened to measure them — worst mistake first, where "worst" means the claim
 * an owner can disprove fastest and most completely.
 */
export const AVOID_IF_PASSED: Record<string, string> = {
  no_website: 'Don’t say they have no website. They have one, and they know it.',
  no_https: 'Don’t say the site is insecure — it is served over HTTPS and they can see the padlock.',
  invalid_certificate:
    'Don’t mention certificate warnings. The certificate verifies; claiming otherwise ends the call.',
  not_mobile_friendly:
    'Don’t open with “it doesn’t work on a phone”. It does, and they will check while you talk.',
  no_imprint: 'Don’t say there is no Impressum. There is one, and it is linked.',
  no_privacy_policy: 'Don’t say there is no privacy policy. There is one.',
  // Only `psi_weak` is ever written as a pass — `judgePerformance` uses it for
  // the passing grade as well as the middling one — so there is deliberately no
  // `psi_poor` entry here. It would be a line that can never fire.
  psi_weak: 'Don’t call the site slow. Google’s own test does not.',
  poor_lcp: 'Don’t say it takes forever to appear. Measured, it does not.',
  stale_copyright: 'Don’t say the site looks abandoned — the footer is current.',
  outdated_wordpress: 'Don’t bring up an out-of-date WordPress. It is on a supported release.',
}
