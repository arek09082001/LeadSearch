-- Lead Engine — deny-by-default lockdown.
--
-- Authorization for this app lives in the Next.js auth gate, not in Postgres:
-- NextAuth owns sessions, so there is no Supabase JWT and no auth.uid() for a
-- policy to inspect. Any auth.uid()-based policy here would match nothing and
-- only create the illusion of protection.
--
-- So the database's job is narrower and absolute: be unreachable by anyone but
-- the server. Three independent layers, any one of which would suffice:
--   1. RLS enabled with NO policies      -> zero rows visible to anon/authenticated
--   2. table privileges revoked          -> no access even if a policy appears
--   3. schema USAGE revoked              -> PostgREST cannot resolve the tables
-- The service role bypasses all three, and only the server holds that key.

alter table public.searches            enable row level security;
alter table public.search_results      enable row level security;
alter table public.leads               enable row level security;
alter table public.lead_audits         enable row level security;
alter table public.lead_audit_findings enable row level security;
alter table public.lead_scores         enable row level security;
alter table public.lead_notes          enable row level security;
alter table public.lead_activities     enable row level security;
alter table public.lists               enable row level security;
alter table public.lead_lists          enable row level security;

-- Intentionally no policies. Supabase's security advisor reports
-- "RLS enabled, no policy" as an informational notice; here that notice is the
-- desired state, not a finding to fix.

-- Layer 2 — privileges. Supabase's default privileges hand new public tables to
-- anon/authenticated, so revoking after the fact is not optional.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Layer 3 — the kill switch. Without USAGE on the schema, a leaked publishable
-- key cannot even name these tables.
--
-- The revoke from PUBLIC is the load-bearing half, and leaving it out is the
-- easy mistake: Postgres grants USAGE on `public` to the PUBLIC pseudo-role by
-- default, and every role inherits it. Revoking from `anon` and `authenticated`
-- alone removes their own grants and changes nothing, because the blanket grant
-- underneath is still there — `has_schema_privilege('anon','public','USAGE')`
-- keeps answering true and the layer is inert.
--
-- The two grants come first so the revoke cannot lock out the roles that have
-- to reach these tables. Both already hold on a Supabase project; restating them
-- makes this file correct on its own rather than dependent on what the platform
-- happened to set up.
grant usage on schema public to postgres, service_role;

revoke usage on schema public from public;
revoke usage on schema public from anon, authenticated;
