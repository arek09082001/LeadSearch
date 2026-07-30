-- Lead Engine — extensions, enums, shared trigger helpers.
--
-- Vocabulary policy: an enum is used only where the vocabulary is DECIDED.
-- Audit check codes and scoring factor keys are deliberately NOT enums — those
-- criteria are still open, and encoding them in the type system would force a
-- migration every time a check is added.

-- gen_random_uuid() is built into Postgres 13+; no pgcrypto needed.

-- Fuzzy name search inside the leads library ("search-within-leads" is
-- load-bearing per PRODUCT.md, and the library is expected to reach thousands).
-- Installed into `extensions` per Supabase convention, which also keeps the
-- security advisor from flagging an extension living in public.
create extension if not exists pg_trgm with schema extensions;

-- Lead lifecycle. Decided by the owner:
--   new -> researching -> contacted -> replied -> proposal -> won | lost | parked
create type public.lead_status as enum (
  'new',
  'researching',
  'contacted',
  'replied',
  'proposal',
  'won',
  'lost',
  'parked'
);

-- What the audit found at the front door. This is the one signal the whole
-- product is named after ("weak or MISSING web presence"), so it is a column,
-- not a finding.
create type public.website_status as enum (
  'no_website',   -- the business has no website at all
  'unreachable',  -- a URL exists but did not resolve / respond
  'reachable',    -- the site answered and was audited
  'error'         -- the audit itself failed; says nothing about the business
);

-- Finding weight. Kept coarse on purpose; the scoring config decides what each
-- level is worth, so the audit never bakes in a weighting.
create type public.audit_severity as enum ('critical', 'warning', 'info');

-- Outreach log vocabulary.
create type public.activity_type as enum (
  'call',
  'email',
  'message',
  'visit',
  'meeting',
  'status_change', -- written automatically when leads.status changes
  'other'
);

-- Touch updated_at on write.
-- search_path is pinned empty and every identifier is schema-qualified, which
-- is what keeps Supabase's security advisor quiet about mutable search paths.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
