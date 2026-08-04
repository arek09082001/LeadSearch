import type { NextAuthConfig } from 'next-auth'

/*
 * The edge-safe half of the auth setup.
 *
 * proxy.ts runs in the edge runtime, where node:crypto's scrypt does not exist,
 * so the Credentials provider is added only in auth.ts (Node). This file holds
 * everything the proxy legitimately needs: the routing rules.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    // A single operator on his own machine. Long sessions, re-auth weekly.
    maxAge: 60 * 60 * 24 * 7,
  },
  callbacks: {
    authorized({ auth, request }) {
      const signedIn = Boolean(auth?.user)
      const { pathname } = request.nextUrl

      if (pathname === '/login' || pathname.startsWith('/login/')) {
        // The owner has no reason to sit on the login page.
        if (signedIn) return Response.redirect(new URL('/search', request.nextUrl))
        return true
      }

      /*
       * The scheduler is let past, and only the scheduler's own prefix is.
       *
       * A cron trigger has no browser and therefore no cookie, so a session
       * gate would turn every nightly run into a redirect to /login. Its
       * credential is a bearer secret checked inside the route — see
       * `requireSchedule` in lib/api/guard.ts, which refuses when the secret is
       * unset rather than falling open. This is the one place in the product
       * where the proxy is not the outer lock, which is why the prefix is
       * matched exactly rather than by a pattern that could widen.
       */
      if (pathname.startsWith('/api/cron/')) return true

      /*
       * The MCP endpoint, on the same terms and for the same reason: an
       * assistant calling a tool is a program, not a browser, and has no cookie
       * to present. Its credential is `MCP_TOKEN`, checked by `requireMcpClient`
       * in the route itself — which also refuses when the variable is unset,
       * because the tools behind it spend money and write to the library.
       *
       * Exact, not a prefix that could widen: `=== '/api/mcp'` rather than
       * `startsWith`, so nothing that happens to be filed under a longer path
       * inherits the exemption.
       */
      if (pathname === '/api/mcp') return true

      // Everything else is the operator's own instrument.
      return signedIn
    },
  },
  providers: [],
} satisfies NextAuthConfig
