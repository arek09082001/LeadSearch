'use server'

import { AuthError } from 'next-auth'

import { signIn, signOut } from '@/auth'

export type SignInState = { error: string | null }

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Enter both an email address and a passphrase.' }
  }

  try {
    await signIn('credentials', { email, password, redirectTo: '/search' })
  } catch (error) {
    // signIn throws a redirect on success; that must propagate untouched.
    if (error instanceof AuthError) {
      return {
        error:
          error.type === 'CredentialsSignin'
            ? 'That email and passphrase do not match the owner account.'
            : 'Sign-in failed. Check the server logs for the cause.',
      }
    }
    throw error
  }

  return { error: null }
}

export async function signOutAction() {
  await signOut({ redirectTo: '/login' })
}
