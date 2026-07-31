import type { Metadata } from 'next'

import { LoginForm } from '@/app/login/login-form'
import { Wordmark } from '@/components/shell/wordmark'

export const metadata: Metadata = { title: 'Sign in — Lead Engine' }

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="border-b border-rule px-3 py-2">
        <Wordmark />
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[38ch]">
          <h1 className="text-xl font-semibold text-ink">Open a session</h1>
          <p className="mt-1.5 mb-6 text-sm text-ink-dim">
            One operator, one account. There is no sign-up.
          </p>
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
