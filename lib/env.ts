/*
 * Environment variable access, validated on use rather than on import.
 *
 * Getters, not values: `next build` collects page data by importing modules, so
 * a module that throws at import time fails the build even for pages that never
 * touch Supabase.
 *
 * Nothing here is NEXT_PUBLIC_. NextAuth owns sessions and Supabase is reached
 * only from the server, so the browser needs no Supabase credentials at all.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value
}

export const env = {
  get SUPABASE_URL() {
    return required('SUPABASE_URL', process.env.SUPABASE_URL)
  },
  get SUPABASE_SECRET_KEY() {
    return required('SUPABASE_SECRET_KEY', process.env.SUPABASE_SECRET_KEY)
  },

  /**
   * Which call assistant answers: `mock` or `anthropic`.
   *
   * Optional, and it defaults to the one that costs nothing. `monthly_ceiling_usd`
   * is 0, so an unset variable must not be the path to a billable model — the
   * expensive behaviour is the one that has to be asked for by name.
   *
   * Validated in `lib/assistant/index.ts` rather than here: this file's job is
   * to say what the environment holds, and the registry is the only thing that
   * knows which ids exist.
   */
  get ASSISTANT_PROVIDER() {
    return process.env.ASSISTANT_PROVIDER || 'mock'
  },
}
