import 'server-only'

import type { Deadline } from '@/lib/deadline'
import { cityFrom, saveLeads } from '@/lib/leads/repository'
import type { SaveCandidate } from '@/lib/leads/types'
import { queueAudit } from '@/lib/mcp/enrich'
import { bulkUpdateLeads } from '@/lib/mcp/leads'
import {
  logMcpCall,
  readKnownPlaceIds,
  readSiteCheckAllowance,
  rememberSkipped,
} from '@/lib/mcp/store'
import {
  HARD_FLOOR,
  PRESELECTION_DEFAULTS,
  countByReason,
  isRemembered,
  type LeadType,
  type SavedLead,
  type SearchPlacesResult,
  type SkipReason,
} from '@/lib/mcp/vocabulary'
import { runSearch } from '@/lib/search/run'
import type { SearchRow } from '@/lib/search/types'
import { checkSites, type WeaknessSignal } from '@/lib/services/site-check'

/*
 * `search_places` — discovery that decides for itself.
 *
 * Every other door into this data puts rows on a screen and waits for a person.
 * This one runs the search, judges what comes back, writes what is worth
 * keeping, remembers what is not, and reports afterwards. PRODUCT.md's second
 * principle says saving is deliberate and nothing enters the library as a side
 * effect of looking — that principle is not weakened here, it is relocated: the
 * deliberate act is the tool call, and the rule below is what the operator
 * deliberated. `autoSave: false` is the same call with the writing switched off.
 *
 * THE ORDER OF THE RULE IS THE COST POLICY, exactly as it is in `runSearch`:
 *
 *   1. Already decided about?     -> one index lookup, and we stop
 *   2. Fails a hard floor?        -> free, in memory
 *   3. No website at all?         -> save it. Nothing left to check
 *   4. Worth spending a check on? -> free, in memory, and the operator sets the bar
 *   5. Check the website          -> eight seconds and a request to a stranger
 *
 * Nothing below step five costs anything, and step five is the only step with a
 * daily allowance. A rule that asked these questions in any other order would
 * be equally correct and would spend the day's budget on businesses it was
 * always going to throw away.
 *
 * Discovery itself is `runSearch`, unchanged and unwrapped. That is where the
 * replay cache, the geocode cache, the spend guard and the `api_usage` ledger
 * live, and a tool that reimplemented any of them would be a second way to
 * spend money that the cost readout could not see.
 */

export interface SearchPlacesInput {
  query?: string
  location?: string
  category?: string
  radiusM?: number
  maxResults?: number
  /** Skip the replay cache and pay Google for fresh data. Always an explicit act. */
  refresh?: boolean

  /**
   * Write what the rule decides. On by default — deciding and then not acting
   * would make the common case a two-step conversation. Off is "let me look
   * first": nothing is saved, nothing is remembered as rejected, and `saved`
   * becomes the list that WOULD have been written.
   */
  autoSave?: boolean
  /** The pre-selection bar for a business that already has a website. */
  minReviewCount?: number
  minRating?: number
  /**
   * Category A only. No website is fetched at all, so the run costs no site
   * checks and finds no `weak_website` leads.
   */
  includeNoWebsiteOnly?: boolean

  /**
   * A follow-up day written onto every lead this run saves.
   *
   * Already resolved to `2026-08-14` by the tool boundary — see
   * `lib/mcp/follow-up.ts`. It exists because the alternative is a second round
   * trip: search a town, read back the ids, call `bulk_update_leads` with all of
   * them. That is two tool calls to express one intention ("work these on
   * Thursday"), and the list of ids between them is a thing to get wrong.
   *
   * It never REPLACES a date. A lead already in the book is not saved by this
   * run and is not touched by this field.
   */
  followUpAt?: string
  /** One note, written onto every lead this run saves. Same argument as above. */
  note?: string
}

/** A place that survived the free filters and has a website to fetch. */
interface Candidate {
  row: SearchRow
  website: string
}

function reviewCountOf(row: SearchRow): number {
  return row.userRatingCount ?? 0
}

/**
 * A missing rating is not a passing rating.
 *
 * Google reports one for anything with ratings, so null here means either a
 * business with none — which the review floor has already caught — or a field
 * that did not arrive. Treating the second as 0 is the cautious read, and the
 * cost of being wrong is one business the operator never sees rather than one
 * lead he deletes.
 */
function ratingOf(row: SearchRow): number {
  return row.rating ?? 0
}

/**
 * The five questions that cost nothing, asked in the order that matters.
 *
 * `alreadyKnown` leads because it is the only answer that ends the
 * conversation: reporting `notOperational` for a business already sitting in
 * the book would name a fault the operator has no action for.
 */
function hardFilter(row: SearchRow, known: Set<string>): SkipReason | null {
  if (known.has(row.providerPlaceId) || row.savedLeadId) return 'alreadyKnown'
  if (row.businessStatus !== HARD_FLOOR.businessStatus) return 'notOperational'
  if (!row.phone && !row.formattedAddress) return 'noContact'
  if (reviewCountOf(row) < HARD_FLOOR.minReviewCount) return 'tooFewReviews'
  if (ratingOf(row) < HARD_FLOOR.minRating) return 'ratingTooLow'
  return null
}

function savedLeadOf(row: SearchRow, leadType: LeadType, signals: WeaknessSignal[]): SavedLead {
  return {
    placeId: row.providerPlaceId,
    name: row.name,
    city: cityFrom(row.formattedAddress),
    leadType,
    rating: row.rating,
    reviewCount: row.userRatingCount,
    weaknessSignals: signals,
  }
}

function candidateOf(row: SearchRow, leadType: LeadType, signals: WeaknessSignal[]): SaveCandidate {
  return {
    googlePlaceId: row.providerPlaceId,
    name: row.name ?? row.providerPlaceId,
    formattedAddress: row.formattedAddress,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    website: row.website,
    rating: row.rating,
    userRatingCount: row.userRatingCount,
    businessStatus: row.businessStatus,
    primaryType: row.primaryType,
    types: row.types,
    mapsUri: row.mapsUri,
    raw: row.raw,
    fetchedAt: row.fetchedAt,
    leadType,
    weaknessSignals: signals,
  }
}

/**
 * `deadline` is the request's, handed down rather than invented here.
 *
 * A run of sixty results can want sixty website checks, and at five at a time
 * with an eight-second timeout each that is longer than the platform will let
 * the function live. Without it the function is killed mid-flight: the leads
 * already saved are on disk, the rejections are not, and the caller gets the
 * gateway's HTML where it asked for JSON. With it the pool stops taking new
 * work in time to write an honest answer about what it managed.
 */
export async function searchPlaces(
  input: SearchPlacesInput,
  deadline?: Deadline,
): Promise<SearchPlacesResult> {
  const started = Date.now()
  const autoSave = input.autoSave ?? true
  const minReviewCount = input.minReviewCount ?? PRESELECTION_DEFAULTS.minReviewCount
  const minRating = input.minRating ?? PRESELECTION_DEFAULTS.minRating
  const noWebsiteOnly = input.includeNoWebsiteOnly ?? false

  /* --- 1. Discovery, through the door that already exists ---------------- */

  const rows: SearchRow[] = []
  const seen = new Set<string>()
  let placesCalls = 0
  let searchId: string | null = null
  /*
   * Collected rather than assigned, because more than one of these can be true
   * at once — the ceiling can stop the search AND the clock can stop the checks
   * AND an insert can fail. A single `notice` variable would report whichever
   * happened last and silently drop the rest.
   */
  const notices: string[] = []

  for await (const event of runSearch(
    {
      query: input.query ?? '',
      location: input.location,
      category: input.category,
      radiusM: input.radiusM,
      maxResults: input.maxResults,
      refresh: input.refresh,
    },
    // Same signal the website checks get: a search cut off by the deadline stops
    // paying Google for pages nobody will read, and finalises what it did fetch.
    deadline?.signal,
  )) {
    switch (event.type) {
      case 'meta':
        searchId = event.searchId
        break
      case 'results':
        /*
         * Deduplicate again, here. `runSearch` already dedupes across its own
         * pages, but a replayed result set and a live one reach this loop by
         * different paths and the rule below writes to the database — a place
         * counted twice would be one wasted site check and one confusing count.
         */
        for (const row of event.rows) {
          if (seen.has(row.providerPlaceId)) continue
          seen.add(row.providerPlaceId)
          rows.push(row)
        }
        break
      case 'cost':
        // Cumulative, so the last one wins rather than the sum of them.
        placesCalls = event.requests
        break
      case 'blocked':
        notices.push(
          `${event.message} What follows is only what arrived before the ceiling stopped the search.`,
        )
        break
      case 'error':
        notices.push(event.message)
        break
      case 'done':
        break
    }
  }

  /* --- 2. Everything already decided about ------------------------------- */

  const known = await readKnownPlaceIds(rows.map((row) => row.providerPlaceId))

  const saved: SavedLead[] = []
  const toSave: SaveCandidate[] = []
  const skipped: { placeId: string; reason: SkipReason }[] = []

  const reject = (placeId: string, reason: SkipReason) => skipped.push({ placeId, reason })
  const keep = (row: SearchRow, leadType: LeadType, signals: WeaknessSignal[]) => {
    saved.push(savedLeadOf(row, leadType, signals))
    toSave.push(candidateOf(row, leadType, signals))
  }

  /* --- 3. The free filters, and category A ------------------------------- */

  const preselected: Candidate[] = []

  for (const row of rows) {
    const failed = hardFilter(row, known)
    if (failed) {
      reject(row.providerPlaceId, failed)
      continue
    }

    const website = row.website?.trim() || null

    /*
     * Category A. No website is not a signal that needs corroborating — it IS
     * the product's thesis, and there is nothing to fetch. Saved on sight.
     */
    if (!website) {
      keep(row, 'no_website', [])
      continue
    }

    if (noWebsiteOnly) {
      reject(row.providerPlaceId, 'hasWebsite')
      continue
    }

    // Category B's bar: enough standing that a fault on the site is worth a
    // phone call. Below it, the site is not fetched and nothing is remembered.
    if (reviewCountOf(row) < minReviewCount || ratingOf(row) < minRating) {
      reject(row.providerPlaceId, 'belowPreselection')
      continue
    }

    preselected.push({ row, website })
  }

  /* --- 4. Category B, the only step with an allowance -------------------- */

  const allowance = await readSiteCheckAllowance()
  const affordable = preselected.slice(0, allowance.remaining)

  for (const { row } of preselected.slice(allowance.remaining)) {
    // Not written to `skipped_places`: nobody judged this business. It is
    // examined again tomorrow, with tomorrow's allowance.
    reject(row.providerPlaceId, 'quotaReached')
  }

  /*
   * The day's allowance stopped this run short.
   *
   * A FLAG RATHER THAN A SHORTER LIST, and that is the whole point of it. Cut
   * off at the allowance, this run returns fewer saved leads than the same
   * search would have returned an hour earlier — and `saved: []` reads exactly
   * like a market that has already been worked. The counts under
   * `skipped.byReason.quotaReached` have always said so, but they say it in a
   * place a caller has to think to look; a boolean at the top level is something
   * it can branch on.
   *
   * Deliberately NOT set by the deadline running out. That is the platform's
   * sixty seconds rather than the operator's allowance: it means "come back now
   * and the rest will be checked", where this one means "come back tomorrow".
   * The two have their own sentences in `notices` for the same reason.
   */
  const limitReached = preselected.length > affordable.length
  if (limitReached) {
    notices.push(
      `The daily website-check allowance ran out: ${preselected.length - affordable.length} ` +
        'business(es) were left unchecked and unremembered, and will be examined by the next ' +
        "search. Raise app_settings.mcp_site_check_daily_limit if this is happening every day.",
    )
  }

  const checks = await checkSites(
    affordable.map((candidate) => candidate.website),
    { signal: deadline?.signal },
  )

  let siteChecks = 0
  for (const [index, { row }] of affordable.entries()) {
    const check = checks[index]

    /*
     * A hole means the clock ran out before this one was started — the request
     * has to answer inside the platform's window, and the pool stops taking new
     * work rather than being killed mid-write.
     *
     * `quotaReached`, not `hasGoodWebsite`. Reading an empty slot as "the site
     * was fine" would write a permanent rejection about a business nobody
     * looked at, which is the one mistake in this whole rule that cannot be
     * noticed afterwards. It comes back on the next call.
     */
    if (!check) {
      reject(row.providerPlaceId, 'quotaReached')
      continue
    }

    siteChecks += 1
    if (check.signals.length) {
      keep(row, 'weak_website', check.signals)
    } else {
      reject(row.providerPlaceId, 'hasGoodWebsite')
    }
  }

  if (siteChecks < affordable.length) {
    notices.push(
      `The request ran out of time after ${siteChecks} of ${affordable.length} website checks. ` +
        'The rest were left undecided and will be examined by the next search.',
    )
  }

  /* --- 5. Write it down --------------------------------------------------- */

  if (autoSave) {
    if (toSave.length) {
      // The note goes through `saveLeads`' own note path — the one `save_leads`
      // already uses — rather than being applied afterwards. One mechanism for
      // "a note on everything this call saved", shared by both tools.
      const result = await saveLeads({
        candidates: toSave,
        searchId,
        note: input.note?.trim() || null,
      })
      /*
       * A failed insert must not be reported as a saved lead. The tool's answer
       * is the only account of this run anybody will read, and an assistant told
       * six were saved will go on to work six businesses that are not there.
       */
      const failures = new Set(
        result.items.filter((item) => item.outcome === 'failed').map((item) => item.googlePlaceId),
      )
      if (failures.size) {
        for (let index = saved.length - 1; index >= 0; index -= 1) {
          if (failures.has(saved[index].placeId)) saved.splice(index, 1)
        }
        notices.push(
          `${failures.size} of ${toSave.length} leads could not be written and are not listed above.`,
        )
      }

      const savedIds = result.items
        .filter((item) => item.leadId && item.outcome !== 'failed')
        .map((item) => item.leadId!)

      /*
       * The follow-up date, onto exactly what was written.
       *
       * After `saveLeads` rather than as another field on its candidate shape,
       * and that is not squeamishness about the insert. `saveLeads` is the ONE
       * path that creates a lead and it is shared with the browser's save
       * button; a follow-up date belongs to the caller that asked for these
       * leads, not to the act of creating one. `bulk_update_leads` is already
       * the tool for "set a date on these ids", so this is that, called
       * directly.
       *
       * `savedIds` and not `toSave`: a lead whose insert failed is not given a
       * callback date, for the same reason it is not reported as saved.
       *
       * A failure is a notice rather than an exception. The leads exist and are
       * listed in the answer; throwing here would report a failed search that
       * had in fact written every row, and the obvious response — running it
       * again — would cost another set of Places calls to save nothing.
       */
      if (savedIds.length && input.followUpAt) {
        try {
          const applied = await bulkUpdateLeads(savedIds, { followUpAt: input.followUpAt })
          if (applied.notice) notices.push(applied.notice)
        } catch (error) {
          notices.push(
            `The leads were saved, but the follow-up date could not be written: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          )
        }
      }

      queueAudit(savedIds)
    }

    await rememberSkipped(skipped.filter((entry) => isRemembered(entry.reason)))
  } else {
    notices.push(
      `autoSave is off: nothing was written, and nothing was remembered as rejected. ` +
        `The ${saved.length} lead(s) listed are what would have been saved.` +
        (input.followUpAt || input.note?.trim()
          ? ' followUpAt and note were not applied either — there is nothing to apply them to.'
          : ''),
    )
  }

  const notice = notices.join(' ') || null

  await logMcpCall({
    tool: 'search_places',
    params: input,
    savedCount: saved.length,
    skippedCount: skipped.length,
    placesCalls,
    siteChecks,
    durationMs: Date.now() - started,
    searchId,
    error: notice,
  })

  return {
    saved,
    skipped: countByReason(skipped.map((entry) => entry.reason)),
    limitReached,
    quotaUsed: {
      placesCalls,
      siteChecks,
      remainingToday: Math.max(0, allowance.remaining - siteChecks),
    },
    ...(notice ? { notice } : {}),
  }
}
