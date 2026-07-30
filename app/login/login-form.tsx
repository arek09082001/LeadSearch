'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { CommandButton } from '@/components/ui/command-button'
import { signInAction, type SignInState } from '@/app/auth/actions'

const FIELD =
  'w-full border border-rule bg-ground px-2.5 py-2 font-data text-sm text-ink ' +
  'transition-colors duration-150 hover:border-rule-strong focus:border-signal focus:outline-none'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <CommandButton type="submit" variant="primary" disabled={pending} className="w-full justify-center">
      {pending ? 'Opening…' : 'Open session'}
    </CommandButton>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(signInAction, { error: null })

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="label text-ink-faint">
          Operator
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@example.com"
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="label text-ink-faint">
          Passphrase
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={FIELD}
        />
      </div>

      {state.error ? (
        <p role="alert" className="border-l border-alert pl-2.5 text-sm text-alert">
          {state.error}
        </p>
      ) : null}

      <div className="mt-1">
        <Submit />
      </div>
    </form>
  )
}
