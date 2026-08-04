import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { Unauthorized, requireMcpClient } from '@/lib/api/guard'
import { Deadline } from '@/lib/deadline'
import { createMcpServer } from '@/lib/mcp/server'

/*
 * The MCP endpoint: Lead Engine as two tools an assistant can call.
 *
 * Streamable HTTP, in the app rather than as a separate process, because
 * everything the tools need is already here — the Supabase service client, the
 * spend guard, the provider registry, the audit pass. A standalone stdio server
 * would have to grow its own copy of all four, and the day the two disagreed
 * about the monthly ceiling would be the day money was spent twice.
 *
 * STATELESS, and that is a decision about the platform rather than a shortcut.
 * On Vercel each request may land on a different instance, so a session id
 * handed out by one and presented to another would resolve to nothing — the
 * transport would answer 404 to a client that had done everything right. Both
 * tools are single-shot request/response with no subscriptions and no server
 * notifications, so there is nothing a session would carry.
 *
 * A fresh server and transport per request follows from the same fact. They are
 * closed in a `finally`: a transport left connected on a warm instance is a
 * leak that only shows up under load, which is the worst time to find it.
 */

// node:crypto in the search's params hash, `server-only` throughout the tools.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/*
 * Sixty seconds, the same budget every other route in this app gets.
 *
 * `search_places` is the one route here that could genuinely want more — sixty
 * results can mean sixty website checks — and it is given a deadline inside
 * this window instead. Checks that do not fit come back as undecided and are
 * examined by the next call, which is a better answer than a raised ceiling:
 * the work is bounded by something the operator can read in the response rather
 * than by how long the platform happened to allow.
 */
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    requireMcpClient(request)
  } catch (error) {
    return unauthorized(error)
  }

  /*
   * Ten seconds inside `maxDuration`, which is enough to write the response and
   * finish the database writes the tools have already started. The alternative
   * — running to the platform's own limit — is the function being killed with
   * leads saved and rejections unwritten, and the client reading the gateway's
   * HTML where it asked for JSON-RPC.
   */
  const deadline = Deadline.in(50_000, 'The tool call')

  const server = createMcpServer(deadline)
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Explicitly undefined: stateless. See the note above — this is not a default
    // being accepted, it is a mode being chosen.
    sessionIdGenerator: undefined,
    /*
     * Plain JSON rather than an SSE stream. Nothing here streams: a tool call
     * makes one answer and makes it at the end. An SSE response would be a long
     * -lived connection held open across a serverless boundary for the sake of a
     * single frame.
     */
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } catch (error) {
    console.error('[api/mcp] the transport failed', error)
    /*
     * JSON-RPC's own error envelope, not this app's `{ error }` shape. The
     * caller is a protocol client and will try to parse whatever comes back as
     * a JSON-RPC message; a bare `{"error": "..."}` reaches it as a malformed
     * response and it reports a parse failure instead of the reason.
     */
    return Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'The MCP request failed.',
        },
        id: null,
      },
      { status: 500 },
    )
  } finally {
    deadline.release()
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}

/**
 * GET is the client opening a notification stream, DELETE is it ending a
 * session. A stateless server has neither, and the transport says so itself —
 * but only after the token has been checked, which is why both go through here.
 */
export async function GET(request: Request) {
  return methodOnAStatelessServer(request, 'GET')
}

export async function DELETE(request: Request) {
  return methodOnAStatelessServer(request, 'DELETE')
}

function methodOnAStatelessServer(request: Request, method: string): Response {
  try {
    requireMcpClient(request)
  } catch (error) {
    return unauthorized(error)
  }

  return Response.json(
    {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: `${method} is not supported: this server is stateless and has no session or notification stream. Send tool calls as POST.`,
      },
      id: null,
    },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

/**
 * 401 with a `WWW-Authenticate` header, so a client is told how to fix it
 * rather than left to guess which of its several credentials was wrong.
 */
function unauthorized(error: unknown): Response {
  if (!(error instanceof Unauthorized)) throw error
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message: 'Not authorized.' }, id: null },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="lead-engine-mcp"' } },
  )
}
