import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { env } from '@/lib/env'

/*
 * Supabase as a database, not as an auth provider.
 *
 * Sessions are NextAuth's job now, so there is no Supabase user and no
 * `auth.uid()` to write RLS against. Every query therefore runs server-side
 * with the secret key, and the `server-only` import above is what stops this
 * module from ever being pulled into a client bundle.
 *
 * Consequence worth stating plainly, because it shapes the schema we have not
 * designed yet: authorization lives entirely in this app's own auth gate. Lead
 * Engine's tables must not be reachable through the Data API by the anon or
 * authenticated roles — keep RLS enabled with no permissive policies, or keep
 * the tables in a schema the Data API does not expose.
 */
export function createServiceClient() {
  return createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
