import 'server-only'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { Deadline } from '@/lib/deadline'
import { FOLLOW_UP_FORMATS, FollowUpFormatError, parseFollowUpAt } from '@/lib/mcp/follow-up'
import {
  CursorError,
  DEFAULT_LIMIT,
  LEAD_SORTS,
  LeadUpdateError,
  MAX_BULK_IDS,
  MAX_LIMIT,
  bulkUpdateLeads,
  listLeads,
  updateLead,
} from '@/lib/mcp/leads'
import { saveLeadsByPlaceId } from '@/lib/mcp/save-leads'
import { searchPlaces } from '@/lib/mcp/search-places'
import { HARD_FLOOR, PRESELECTION_DEFAULTS, SKIP_REASONS } from '@/lib/mcp/vocabulary'
import { LEAD_STATUSES, LIMITS } from '@/lib/leads/types'
import { logMcpCall } from '@/lib/mcp/store'

/*
 * The five tools, and the words that tell an assistant what they do.
 *
 * The descriptions below are not documentation, they are the interface. Nothing
 * else reaches the model: it will decide whether to call `search_places`, what
 * to put in `minRating`, and whether an empty `saved` list means a well-worked
 * market or a broken search, entirely from what is written here. Two things are
 * therefore spelled out rather than left to be inferred:
 *
 *   1. `search_places` WRITES. A tool named "search" that saves rows to a
 *      permanent library is a surprise, and a surprise in a tool description is
 *      how an assistant ends up filling somebody's book by accident.
 *   2. Both tools cost real money and real quota. The model should know that
 *      calling it twice with slightly different words is not free.
 *
 * A fresh `McpServer` per request. It holds no state worth keeping between
 * calls, the transport is stateless, and on a serverless platform a module-level
 * singleton would be shared by whatever invocations happen to land on the same
 * warm instance.
 */

export const MCP_SERVER_INFO = {
  name: 'lead-engine',
  version: '1.0.0',
} as const

const SEARCH_PLACES_DESCRIPTION = `Search Google Places for local businesses and SAVE the ones worth approaching.

This tool writes to the permanent leads library. It is not a read-only search.

Every result is judged by a fixed rule:

- Discarded outright, never saved: not currently operational; no phone AND no
  address; fewer than ${HARD_FLOOR.minReviewCount} ratings; rated below ${HARD_FLOOR.minRating}; or already in the library
  or already rejected by an earlier run.
- Saved as lead_type="no_website": Google reports no website. Saved on sight.
- Saved as lead_type="weak_website": has a website, clears the pre-selection bar
  (minReviewCount / minRating), and fetching it found at least one fault —
  unreachable, error status, no HTTPS, an invalid certificate, no mobile
  viewport, a builder subdomain or social profile instead of a real domain, a
  builder footer, or a copyright year more than three years old. The faults are
  returned in weaknessSignals.
- Everything else is discarded, and its place id is remembered so the next
  search does not pay to examine it again.

Costs: Google Places requests (billed, bounded by the monthly ceiling) and
website fetches (free, bounded by a daily allowance). Both are reported in
quotaUsed. Saved leads are listed one by one; discarded ones are counts only.

Set autoSave=false to see what the rule would do without writing anything.`

const SAVE_LEADS_DESCRIPTION = `Save specific businesses to the leads library by Google place id, overruling search_places.

Use this when the operator wants a business that search_places discarded. The
place id is removed from the rejected list, so future searches will consider it
again rather than silently skipping it.

The business must have been returned by a recent search — the data comes from
this app's own cached results, not from a fresh Google call. Place ids whose
cache has expired come back in notFound and cost nothing.

Leads saved this way get lead_type="manual". This tool never checks a website
and never claims a fault.`

/*
 * The three tools that work the book rather than fill it.
 *
 * The line they all draw, and the reason it is stated in every one of their
 * descriptions: NONE OF THEM CHANGES lead_type. That column says why a business
 * is in the library — Google reported no website, a fetch found a named fault,
 * or a person decided — and it is the one field on a lead that cannot be
 * reconstructed later from anything else. `save_leads` looks like the tool for
 * setting a follow-up date on an existing lead and is not: it writes
 * lead_type="manual", so using it that way would quietly erase the reason every
 * lead it touched was saved.
 */

const LIST_LEADS_DESCRIPTION = `List leads already in the library. Read-only: writes nothing, costs nothing.

Start here when the operator asks about leads he already has — what is due, what
is still "new", what was saved in Heilbronn last week. The other tools need lead
ids and this is where they come from.

Filters combine with AND. Soft-deleted leads are never returned.

Paging is by cursor: pass nextCursor back as cursor to get the next page, with
the same sort and desc it was issued for. total is the number of matching leads
and is returned on the first page only.

followUpBefore is INCLUSIVE — "2026-08-04" includes leads due ON the 4th, so
passing today's date is the "due now" question (overdue or due today).`

const UPDATE_LEAD_DESCRIPTION = `Update one lead: its status, its follow-up date, and its notes.

This is the tool for working a lead the library already has. Every field is
optional; only what is given is written.

- status moves the lead through the pipeline and is logged as a transition.
- followUpAt accepts ${FOLLOW_UP_FORMATS}. Pass null to clear the date. Dates are
  days in the operator's own timezone, not the server's.
- followUpNote records WHY the callback was set. It is appended to the lead's
  notes with the date, never overwritten.
- note is appended to the lead's notes as its own entry.

It cannot change lead_type, and that is why save_leads is the wrong tool for
this: save_leads would relabel the lead as lead_type="manual".

Returns the lead as it now stands, so the resolved follow-up date can be read
back and checked.`

const BULK_UPDATE_LEADS_DESCRIPTION = `Update the same fields on many leads at once, by lead id.

The same fields update_lead takes, applied to up to ${MAX_BULK_IDS} leads. Use it after
list_leads to act on a whole filtered set — park everything still "new" in a
town, or move a week's follow-ups on by three days.

PARTIALLY SUCCEEDS ON PURPOSE. Ids that are not in the library, or that the
operator has deleted, come back in notFound and everything else is still
written. Check updated against the number of ids you sent rather than assuming
all of them landed.

Like update_lead, it cannot change lead_type.`

/**
 * `deadline` is the request's own, passed in by the route.
 *
 * The server does not make one for itself because it does not know what it is
 * running under — the same two tools would want a different budget behind a
 * long-running worker than behind a serverless function with sixty seconds.
 * Only the route knows which it is.
 */
export function createMcpServer(deadline?: Deadline): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    capabilities: { tools: {} },
    instructions:
      'Lead Engine finds local businesses with a weak or missing web presence, and keeps ' +
      'the operator’s account of working them. search_places discovers and saves; ' +
      'save_leads overrules what it discarded; list_leads finds what is already there; ' +
      'update_lead and bulk_update_leads set status, follow-up dates and notes on it. ' +
      'Only the first two spend a bounded budget — prefer one well-formed search over ' +
      'several narrow ones, and use list_leads freely, since reading costs nothing. ' +
      'Nothing but search_places and save_leads may decide why a lead is in the book: ' +
      'lead_type is never changed by an update.',
  })

  server.registerTool(
    'search_places',
    {
      title: 'Search and save local businesses',
      description: SEARCH_PLACES_DESCRIPTION,
      inputSchema: {
        query: z
          .string()
          .max(200)
          .optional()
          .describe('Free text, e.g. "Zahnarzt". Either this or category is required.'),
        location: z
          .string()
          .max(200)
          .optional()
          .describe('Where to search, as typed, e.g. "Heilbronn". Needed for radiusM to mean anything.'),
        category: z
          .string()
          .max(80)
          .optional()
          .describe('A Google Places type token, e.g. "dentist". Either this or query is required.'),
        radiusM: z
          .number()
          .int()
          .positive()
          .max(50_000)
          .optional()
          .describe('Search radius in metres around the resolved location. Ignored without a location.'),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(60)
          .optional()
          .describe("Google's own ceiling is 60. Each 20 results is one billable request."),
        refresh: z
          .boolean()
          .optional()
          .describe(
            'Skip the replay cache and pay Google for fresh data. An identical search within a week is otherwise free.',
          ),
        autoSave: z
          .boolean()
          .optional()
          .describe(
            'Default true. False runs the whole rule and writes nothing — saved becomes what WOULD have been saved. Website checks still happen and still count against the daily allowance.',
          ),
        minReviewCount: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            `Default ${PRESELECTION_DEFAULTS.minReviewCount}. A business with a website needs this many ratings before its site is worth fetching. Does not affect the hard floor of ${HARD_FLOOR.minReviewCount}.`,
          ),
        minRating: z
          .number()
          .min(0)
          .max(5)
          .optional()
          .describe(
            `Default ${PRESELECTION_DEFAULTS.minRating}. Same idea for the average. Does not affect the hard floor of ${HARD_FLOOR.minRating}.`,
          ),
        includeNoWebsiteOnly: z
          .boolean()
          .optional()
          .describe(
            'Default false. True saves only businesses with no website at all and fetches no sites, so the run costs no website checks.',
          ),
        followUpAt: z
          .string()
          .max(40)
          .optional()
          .describe(
            `Write this follow-up date onto every lead this run saves. Accepts ${FOLLOW_UP_FORMATS}. Leads already in the library are not touched. Ignored when autoSave is false.`,
          ),
        note: z
          .string()
          .max(LIMITS.note)
          .optional()
          .describe(
            'One note, written onto every lead this run saves. Ignored when autoSave is false.',
          ),
      },
    },
    async (input) => {
      if (!input.query?.trim() && !input.category?.trim()) {
        return textResult({ error: 'Give a query, a category, or both. A search needs one of them.' }, true)
      }

      /*
       * The date is resolved BEFORE the search runs, not after it saves.
       *
       * Sixty Places results and a batch of website checks stand between this
       * line and the write, and all of it is billable. Discovering there that
       * "next Tuesday" is not a form this product parses would mean paying for
       * the whole run and then refusing to record what it was for.
       */
      let followUpAt: string | undefined
      try {
        followUpAt = parseFollowUpAt(input.followUpAt) ?? undefined
      } catch (error) {
        return formatError(error)
      }

      return textResult(await searchPlaces({ ...input, followUpAt }, deadline))
    },
  )

  server.registerTool(
    'save_leads',
    {
      title: 'Save businesses by place id',
      description: SAVE_LEADS_DESCRIPTION,
      inputSchema: {
        placeIds: z
          .array(z.string().min(1).max(200))
          .min(1)
          .max(50)
          .describe('Google place ids from a recent search.'),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('One note, written onto every lead saved in this call.'),
      },
    },
    async (input) => textResult(await saveLeadsByPlaceId(input)),
  )

  server.registerTool(
    'list_leads',
    {
      title: 'List leads already in the library',
      description: LIST_LEADS_DESCRIPTION,
      // The one read-only tool here, and the SDK is told so. A client that
      // batches or retries on the strength of these hints must not do either to
      // `search_places`, which spends money every time it runs.
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: {
        leadType: z
          .array(z.enum(['no_website', 'weak_website', 'manual']))
          .optional()
          .describe(
            'Why the lead is in the library. no_website and weak_website were decided by search_places; manual is a person.',
          ),
        status: z
          .array(z.enum(LEAD_STATUSES))
          .optional()
          .describe(`Where the lead stands. One of: ${LEAD_STATUSES.join(', ')}.`),
        city: z.string().max(120).optional().describe('Exact town, case-insensitive.'),
        createdAfter: z
          .string()
          .max(40)
          .optional()
          .describe('ISO date or timestamp. A plain date means from that day, UTC.'),
        createdBefore: z
          .string()
          .max(40)
          .optional()
          .describe('ISO date or timestamp. A plain date includes that whole day, UTC.'),
        followUpBefore: z
          .string()
          .max(40)
          .optional()
          .describe(
            `Due on or before this day — inclusive. Accepts ${FOLLOW_UP_FORMATS}. Pass "today" for everything due now.`,
          ),
        hasFollowUp: z
          .boolean()
          .optional()
          .describe('True for leads with a date set, false for those without. Omit for both.'),
        query: z.string().max(120).optional().describe('Free text, matched against the name.'),
        sort: z
          .enum(Object.keys(LEAD_SORTS) as [string, ...string[]])
          .optional()
          .describe(`Default createdAt. One of: ${Object.keys(LEAD_SORTS).join(', ')}.`),
        desc: z
          .boolean()
          .optional()
          .describe('Default true, which with the default sort is newest first.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Default ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT}.`),
        cursor: z
          .string()
          .max(500)
          .optional()
          .describe('nextCursor from the previous page. Use the same sort and desc it was issued for.'),
      },
    },
    async (input) => {
      try {
        return textResult(
          await listLeads({
            ...input,
            sort: input.sort as Parameters<typeof listLeads>[0]['sort'],
            // Resolved here so "today" works in a filter exactly as it does in
            // an update — one vocabulary for days across the whole surface.
            followUpBefore: parseFollowUpAt(input.followUpBefore) ?? undefined,
          }),
        )
      } catch (error) {
        return formatError(error)
      }
    },
  )

  /*
   * The four writable fields, declared once.
   *
   * `update_lead` and `bulk_update_leads` are the same change applied to one
   * lead or to many, and a second copy of this shape is how they would end up
   * accepting different things — the day somebody widens one and not the other
   * is the day "it worked on a single lead" becomes a bug report.
   */
  const updateFields = {
    status: z
      .enum(LEAD_STATUSES)
      .optional()
      .describe(`Where the lead stands. One of: ${LEAD_STATUSES.join(', ')}.`),
    followUpAt: z
      .string()
      .max(40)
      .nullable()
      .optional()
      .describe(
        `When to come back to it. Accepts ${FOLLOW_UP_FORMATS}. null clears the date. Days are the operator's, not the server's.`,
      ),
    followUpNote: z
      .string()
      .max(LIMITS.note)
      .optional()
      .describe('Why the callback was set. Appended to the notes with the date, never overwritten.'),
    note: z
      .string()
      .max(LIMITS.note)
      .optional()
      .describe('Appended to the lead’s notes as its own entry. Nothing is overwritten.'),
  }

  server.registerTool(
    'update_lead',
    {
      title: 'Update one lead',
      description: UPDATE_LEAD_DESCRIPTION,
      inputSchema: {
        leadId: z.string().uuid().describe('The lead id from list_leads. Not a Google place id.'),
        ...updateFields,
      },
    },
    async ({ leadId, ...fields }) => {
      const started = Date.now()
      let followUpAt: string | null | undefined
      try {
        followUpAt = parseFollowUpAt(fields.followUpAt)
      } catch (error) {
        return formatError(error)
      }

      try {
        const result = await updateLead(leadId, { ...fields, followUpAt })
        await logMcpCall({
          tool: 'update_lead',
          params: { leadId, ...fields, followUpAt },
          savedCount: result.updated ? 1 : 0,
          skippedCount: result.updated ? 0 : 1,
          placesCalls: 0,
          siteChecks: 0,
          durationMs: Date.now() - started,
          error: result.notice ?? null,
        })
        return textResult(result, !result.updated)
      } catch (error) {
        return formatError(error)
      }
    },
  )

  server.registerTool(
    'bulk_update_leads',
    {
      title: 'Update many leads',
      description: BULK_UPDATE_LEADS_DESCRIPTION,
      inputSchema: {
        leadIds: z
          .array(z.string().uuid())
          .min(1)
          .max(MAX_BULK_IDS)
          .describe('Lead ids from list_leads. Not Google place ids.'),
        ...updateFields,
      },
    },
    async ({ leadIds, ...fields }) => {
      const started = Date.now()
      let followUpAt: string | null | undefined
      try {
        followUpAt = parseFollowUpAt(fields.followUpAt)
      } catch (error) {
        return formatError(error)
      }

      try {
        const result = await bulkUpdateLeads(leadIds, { ...fields, followUpAt })
        await logMcpCall({
          tool: 'bulk_update_leads',
          params: { leadIds, ...fields, followUpAt },
          savedCount: result.updated,
          skippedCount: result.notFound.length,
          placesCalls: 0,
          siteChecks: 0,
          durationMs: Date.now() - started,
          error: result.notice ?? null,
        })
        return textResult(result)
      } catch (error) {
        return formatError(error)
      }
    },
  )

  return server
}

/**
 * The failures a caller can do something about, as an answer rather than a crash.
 *
 * Three named errors and no catch-all. A malformed date, a stale cursor and an
 * unknown status are all things the model can fix by trying again differently,
 * so they come back as `isError` text it can read. Anything else — a database
 * that will not answer, a bug here — is rethrown and becomes a JSON-RPC error,
 * because a caller told "that did not work" about a broken database will retry
 * it, and the honest answer is that the server is failing.
 */
function formatError(error: unknown) {
  if (
    error instanceof FollowUpFormatError ||
    error instanceof LeadUpdateError ||
    error instanceof CursorError
  ) {
    return textResult({ error: error.message }, true)
  }
  throw error
}

/**
 * The answer, as JSON in a text block.
 *
 * Not `structuredContent`, deliberately: that would need an output schema
 * mirroring these shapes, and a second declaration of a result type is a second
 * thing to keep in step with the first. Every client can read this.
 */
function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

/** Every reason a business can be discarded, so a caller can enumerate them. */
export const SKIP_REASON_LIST = SKIP_REASONS
