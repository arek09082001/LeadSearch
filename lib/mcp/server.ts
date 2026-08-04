import 'server-only'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { Deadline } from '@/lib/deadline'
import { saveLeadsByPlaceId } from '@/lib/mcp/save-leads'
import { searchPlaces } from '@/lib/mcp/search-places'
import { HARD_FLOOR, PRESELECTION_DEFAULTS, SKIP_REASONS } from '@/lib/mcp/vocabulary'

/*
 * The two tools, and the words that tell an assistant what they do.
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
      'Lead Engine finds local businesses with a weak or missing web presence. ' +
      'search_places discovers and saves; save_leads overrules what it discarded. ' +
      'Both spend a bounded budget — prefer one well-formed search over several narrow ones.',
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
      },
    },
    async (input) => {
      if (!input.query?.trim() && !input.category?.trim()) {
        return textResult({ error: 'Give a query, a category, or both. A search needs one of them.' }, true)
      }
      return textResult(await searchPlaces(input, deadline))
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

  return server
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
