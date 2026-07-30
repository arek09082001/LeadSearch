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
}
