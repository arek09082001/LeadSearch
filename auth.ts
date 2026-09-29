import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

import { authConfig } from '@/auth.config'
import { verifyPassword } from '@/lib/password'

class BadCredentials extends CredentialsSignin {
  code = 'credentials'
}

function ownerEmail() {
  return process.env.LEAD_ENGINE_OWNER_EMAIL?.trim().toLowerCase()
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Operator', type: 'email' },
        password: { label: 'Passphrase', type: 'password' },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? '')
          .trim()
          .toLowerCase()
        const password = String(credentials?.password ?? '')

        const owner = ownerEmail()
        const hash = process.env.LEAD_ENGINE_OWNER_PASSWORD_HASH

        // A misconfigured instance must refuse everyone, never admit everyone.
        if (!owner || !hash) {
          throw new BadCredentials()
        }
        if (!email || !password) {
          throw new BadCredentials()
        }
        if (email !== owner || !verifyPassword(password, hash)) {
          throw new BadCredentials()
        }

        return { id: 'owner', email: owner, name: 'Operator' }
      },
    }),
  ],
})
