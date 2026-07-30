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

      // Everything else is the operator's own instrument.
      return signedIn
    },
  },
  providers: [],
} satisfies NextAuthConfig
