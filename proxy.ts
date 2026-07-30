import NextAuth from 'next-auth'

import { authConfig } from '@/auth.config'

// Next 16 calls this "proxy" (formerly middleware). NextAuth's `auth` wrapper
// enforces authConfig.callbacks.authorized on every matched request.
//
// Built from authConfig rather than re-exported from @/auth: the full config
// carries the Credentials provider, whose scrypt verification needs node:crypto
// and cannot be bundled into the edge runtime this file runs in.
const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/auth (NextAuth's own endpoints)
     * - _next/static, _next/image (build output)
     * - favicon.ico and static image files
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
