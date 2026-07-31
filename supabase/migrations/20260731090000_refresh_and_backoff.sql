-- Lead Engine — keeping the snapshot honest, and surviving Google saying no.
--
-- Three things, all of them consequences of the product already working:
--
--   1. THE SNAPSHOT AGES. `leads.fetched_at` has carried the age of the Google
--      columns since the first migration and every surface states it, but
--      nothing has ever made it younger. A refresh path was promised in
--      PRODUCT.md and in the comment on that column; this is the storage for it.
--
--   2. A CHANGE IS NEWS, NOT A FINDING. What the refresh discovers — that a
--      business finally built a website, that its reviews doubled, that Google
--      now calls it permanently closed — is not a fault to be weighed by the
--      scorer. It is something that happened, and it belongs in the lead's
--      history next to the notes, with its own vocabulary. See lib/leads/changes.ts.
--
--   3. PAGESPEED SAYS NO UNDER LOAD. The free tier is rate-limited, and a bulk
--      re-audit is exactly the shape of traffic that trips it. Today a 429 lands
--      as `psi_state = 'failed'` and stays there for ever, so a whole batch can
--      be permanently marked unscoreable by a limit that lifted a minute later.
--      A rate limit is a "not now", and the schema has to be able to say so.

-- ---------------------------------------------------------------------------
-- First: confirm the scheduled jobs actually exist.
--
-- Three functions in earlier migrations are scheduled with cron.schedule() and
-- the compliance promise in PRODUCT.md rests on them running. A defined function
-- and a scheduled one look identical in a diff, so this asserts rather than
-- assumes: if pg_cron was not enabled when those migrations ran — the ordinary
-- way this fails, because the extension has to be available to the role running
-- them — the schedule call is a no-op nobody notices until a year of Google data
-- has quietly failed to expire.
--
-- cron.schedule() upserts by job name, so re-scheduling a job that is already
-- there is free and changes nothing.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'expire-search-results') then
    raise warning 'expire-search-results was not scheduled; scheduling it now.';
    perform cron.schedule(
      'expire-search-results', '15 3 * * *',
      'select public.expire_search_results()'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'purge-deleted-leads') then
    raise warning 'purge-deleted-leads was not scheduled; scheduling it now.';
    perform cron.schedule(
      'purge-deleted-leads', '45 3 * * *',
      'select public.purge_deleted_leads()'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'expire-geocode-cache') then
    raise warning 'expire-geocode-cache was not scheduled; scheduling it now.';
    perform cron.schedule(
      'expire-geocode-cache', '30 3 * * *',
      'select public.expire_geocode_cache()'
    );
  end if;
end
$$;

-- The same question, answerable at any time without superuser and without
-- reading a migration file. `cron.job` is not readable by the app's role, so the
-- one thing worth knowing about it is lifted into a view that is.
create or replace view public.scheduled_jobs
with (security_invoker = off) as
select
  jobname   as name,
  schedule,
  command,
  active
from cron.job;

comment on view public.scheduled_jobs is
  'The database-side scheduled jobs, so the retention promises can be verified from the app rather than taken on trust. security_invoker is off deliberately: cron.job is superuser-only and this view is the sanctioned read of it.';

revoke all on public.scheduled_jobs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- lead_audits — a rate limit is a "not now", not a verdict.
--
-- `psi_state` keeps its five values; what was missing is the ability to say
-- WHEN to try again and HOW MANY TIMES we already have. A 429 now puts the job
-- back to 'pending' with a retry time in the future, so the claim query simply
-- does not see it until then, and the audit keeps saying "waiting on PageSpeed"
-- — which is the truth — instead of "PageSpeed failed", which is not.
--
-- The attempt counter is what stops that being an infinite loop: past the
-- ceiling the job fails for real, with the last error on it.
-- ---------------------------------------------------------------------------
alter table public.lead_audits
  add column psi_attempts    smallint    not null default 0,
  add column psi_retry_after timestamptz;

comment on column public.lead_audits.psi_attempts is
  'How many times PageSpeed has been asked about this audit. Bounded so a permanently rate-limited key cannot loop.';
comment on column public.lead_audits.psi_retry_after is
  'Set when PageSpeed refused for a reason that will pass — a rate limit. The job stays pending and is invisible to the claim until this time.';

-- The claim reads (state, retry_after, audited_at). Rebuilt rather than added
-- to, so the index and the query it serves stay the same shape.
drop index if exists public.lead_audits_psi_queue_idx;
create index lead_audits_psi_queue_idx
  on public.lead_audits (psi_state, psi_retry_after nulls first, audited_at)
  where psi_state in ('pending', 'running');

-- ---------------------------------------------------------------------------
-- lead_refreshes — what changed, and what it changed from.
--
-- A row is written ONLY when something actually changed, or when the refresh
-- failed. "We asked Google and nothing had moved" is already recorded, on
-- `leads.fetched_at`, and writing thousands of empty rows a month to say it
-- again would bury the handful of rows that mean something.
--
-- Before and after are stored whole rather than as a list of column names, for
-- the same reason `lead_scores.factors` stores the arithmetic: two months later
-- the operator wants to read "94 reviews, now 128", and a change log that only
-- says "reviews changed" cannot tell him that.
-- ---------------------------------------------------------------------------
create table public.lead_refreshes (
  id            uuid        primary key default gen_random_uuid(),
  lead_id       uuid        not null references public.leads (id) on delete cascade,

  refreshed_at  timestamptz not null default now(),
  -- 'scheduled' or 'manual'. Text, not an enum: this is a provenance note, and
  -- the set will grow the first time a refresh is triggered some third way.
  source        text        not null default 'scheduled',

  -- The change vocabulary, as codes. Text for the same reason audit finding
  -- codes are text: the list belongs to the application, and adding to it must
  -- not require a migration.
  changes       text[]      not null default '{}',

  -- The volatile Google fields, either side of the refresh.
  before        jsonb,
  after         jsonb,

  -- Set when the refresh itself failed. Says nothing about the business.
  error         text,

  created_at    timestamptz not null default now(),

  constraint lead_refreshes_says_something
    check (array_length(changes, 1) is not null or error is not null)
);

comment on table public.lead_refreshes is
  'Append-only record of Google re-pulls that found something. One row per lead per change, with the values either side of it. Nothing is written when a refresh finds no movement — leads.fetched_at already records that we asked.';
comment on column public.lead_refreshes.changes is
  'Codes from lib/leads/changes.ts. Text, not an enum: the vocabulary belongs to the application.';

create index lead_refreshes_lead_id_refreshed_at_idx
  on public.lead_refreshes (lead_id, refreshed_at desc);
create index lead_refreshes_changes_idx
  on public.lead_refreshes using gin (changes);

-- ---------------------------------------------------------------------------
-- leads — the refresh's own bookkeeping.
--
-- `fetched_at` stays what it has always been: the age of the Google columns
-- beside it, and therefore the thing a staleness rule compares. The columns
-- added here are about the RUN, never about the business — the same split
-- `enrichment_error` and `lead_audits.error` already draw.
-- ---------------------------------------------------------------------------
alter table public.leads
  -- Set while a refresh holds this lead. A serverless invocation can vanish
  -- mid-run, so this is a claim with a timestamp on it and anything held too
  -- long is put back — exactly as enrichment_started_at works.
  add column refresh_started_at timestamptz,
  -- When Google last refused. Kept apart from fetched_at so a failing refresh
  -- can back off without making the snapshot look younger than it is.
  add column refresh_failed_at  timestamptz,
  add column refresh_error      text,
  -- Newest refresh that found something. Maintained by trigger, never written
  -- by the app, exactly like latest_audit_id.
  add column latest_refresh_id  uuid references public.lead_refreshes (id) on delete set null;

comment on column public.leads.refresh_started_at is
  'Claim marker for the refresh pass. Null when nothing holds this lead.';
comment on column public.leads.latest_refresh_id is
  'Newest lead_refreshes row for this lead. Denormalised by trigger; do not write directly.';

-- The refresh claim: oldest snapshot first, among live leads. Partial for the
-- same reason every other library index is.
create index leads_fetched_at_idx on public.leads (fetched_at)
  where deleted_at is null;
-- Putting back what a dead invocation is holding.
create index leads_refresh_started_at_idx on public.leads (refresh_started_at)
  where refresh_started_at is not null;

create or replace function public.refresh_lead_refresh_cache()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead_id uuid;
begin
  if tg_op = 'DELETE' then
    v_lead_id := old.lead_id;
  else
    v_lead_id := new.lead_id;
  end if;

  -- Newest row that actually recorded a change. A failed refresh is history
  -- worth keeping but it is not news about the business, and the mark on the
  -- row in the book must not read as one.
  update public.leads l
     set latest_refresh_id = r.id
    from (
      select id
        from public.lead_refreshes
       where lead_id = v_lead_id
         and array_length(changes, 1) is not null
       order by refreshed_at desc, id desc
       limit 1
    ) r
   where l.id = v_lead_id;

  if not found then
    update public.leads set latest_refresh_id = null where id = v_lead_id;
  end if;

  return null;
end;
$$;

create trigger lead_refreshes_refresh_cache
  after insert or update or delete on public.lead_refreshes
  for each row execute function public.refresh_lead_refresh_cache();

revoke all on function public.refresh_lead_refresh_cache() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- leads_library — rebuilt so a change is a predicate, not a join.
--
-- `change_flags` is the exact counterpart of `audit_flags`: the newest change
-- set as an array, so "show me everyone who has built a website since I saved
-- them" is one overlap test on one relation, and the same filter machinery that
-- already serves the audit serves this with no new query shape.
--
-- Empty rather than synthetic-null-flagged, unlike audit_flags. "Never audited"
-- is a state the operator filters on; "nothing has changed" is the steady state
-- of every row in the book and is not worth a filter.
-- ---------------------------------------------------------------------------
drop view public.leads_library;

create view public.leads_library
with (security_invoker = on) as
select
  l.id,
  l.google_place_id,
  l.name,
  l.formatted_address,
  l.city,
  l.region,
  l.postal_code,
  l.country_code,
  l.phone,
  l.website,
  l.rating,
  l.user_rating_count,
  l.business_status,
  l.primary_type,
  l.google_maps_uri,
  l.fetched_at,

  l.status,
  l.follow_up_at,
  l.saved_at,
  l.deleted_at,
  l.current_score,
  l.scored_at,
  l.latest_audit_id,
  l.last_audited_at,
  l.enrichment_state,
  l.enrichment_error,
  l.refresh_error,

  -- The newest audit's measurements, lifted. Null throughout when a lead has
  -- never been audited, which is a distinct filter from any of the faults.
  a.website_status,
  a.dns_resolves,
  a.is_https,
  a.tls_valid,
  a.tls_expires_at,
  a.is_mobile_friendly,
  a.has_title,
  a.has_meta_description,
  a.has_favicon,
  a.is_table_layout,
  a.load_ms,
  a.copyright_year,
  a.platform,
  a.platform_version,
  a.presence_kind,
  a.psi_state,
  a.psi_performance,
  a.psi_lcp_ms,
  a.psi_cls,

  case
    when l.latest_audit_id is null then array['never_audited']::text[]
    else coalesce(a.failed_codes, '{}'::text[])
  end as audit_flags,

  coalesce(r.changes, '{}'::text[]) as change_flags,
  r.refreshed_at                    as changed_at,

  ll.list_ids,
  coalesce(n.note_count, 0) as note_count
from public.leads l
  left join public.lead_audits a on a.id = l.latest_audit_id
  left join public.lead_refreshes r on r.id = l.latest_refresh_id
  left join lateral (
    select coalesce(array_agg(x.list_id), '{}'::uuid[]) as list_ids
      from public.lead_lists x
     where x.lead_id = l.id
  ) ll on true
  left join lateral (
    select count(*) as note_count
      from public.lead_notes x
     where x.lead_id = l.id
  ) n on true;

comment on view public.leads_library is
  'Read model for the leads list: lead plus its newest audit measurements, its newest change set and its list membership, so every filter is a predicate on one relation.';
comment on column public.leads_library.audit_flags is
  'Every audit filter as one array: failed finding codes, or [never_audited] when the lead has no audit. Match with overlap.';
comment on column public.leads_library.change_flags is
  'The newest change set from the refresh pass, as codes. Empty when nothing has changed since the lead was saved.';

revoke all on public.leads_library from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lockdown, extended to the new table. Same three layers as everything else:
-- the app's auth gate is the only authorization there is.
-- ---------------------------------------------------------------------------
alter table public.lead_refreshes enable row level security;

revoke all on public.lead_refreshes from anon, authenticated;
