-- Lead Engine — what saving needs, and what the library needs to stay usable
-- once it holds thousands of rows.
--
-- Three additions, all on the permanent side:
--
--   1. Soft delete.  The operator will misclick. A delete therefore hides a row
--      and starts a clock; it does not destroy work product.
--   2. Enrichment state.  Saving kicks off an audit in the background, so the
--      library must be able to say "queued", "running" and "failed" as distinct
--      things from "never audited" (last_audited_at is null in all four cases).
--   3. Saved views.  A named filter set the operator returns to. Stored as the
--      filter state itself, not as SQL, so a view survives changes to how the
--      query is built.

-- ---------------------------------------------------------------------------
-- Enrichment lifecycle.
--
-- An enum, unlike the audit check codes: this vocabulary is closed and mine.
-- It describes the job, not the findings, so nothing here pre-empts the audit
-- criteria PRODUCT.md leaves open.
-- ---------------------------------------------------------------------------
create type public.enrichment_state as enum (
  'queued',   -- saved, waiting for the background pass
  'running',  -- the pass has it
  'done',     -- an audit row was written; see latest_audit_id
  'failed'    -- the pass itself broke. Says nothing about the business.
);

-- ---------------------------------------------------------------------------
-- leads — soft delete and enrichment tracking.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column deleted_at            timestamptz,
  add column enrichment_state      public.enrichment_state,
  add column enrichment_queued_at  timestamptz,
  add column enrichment_started_at timestamptz,
  -- Kept separate from lead_audits.error: that column explains a site that did
  -- not answer, this one explains a run that never got far enough to say.
  add column enrichment_error      text;

comment on column public.leads.deleted_at is
  'Soft delete. Set means hidden from the library and free to be re-saved; the purge job removes the row for good after the undo window.';
comment on column public.leads.enrichment_state is
  'Lifecycle of the background audit pass, not its verdict. Null means never queued.';

-- Every list query in the library ends in `deleted_at is null`, so the indexes
-- that serve it are rebuilt partial. Smaller, and Postgres can use them without
-- rechecking the predicate.
drop index public.leads_status_idx;
drop index public.leads_current_score_idx;
drop index public.leads_saved_at_idx;
drop index public.leads_city_idx;
drop index public.leads_follow_up_at_idx;

create index leads_status_idx on public.leads (status)
  where deleted_at is null;
-- The library's default order. `nulls last` matches the query: an unscored lead
-- is unranked, not worst.
create index leads_current_score_idx on public.leads (current_score desc nulls last)
  where deleted_at is null;
create index leads_saved_at_idx on public.leads (saved_at desc)
  where deleted_at is null;
create index leads_city_idx on public.leads (city)
  where deleted_at is null;
create index leads_follow_up_at_idx on public.leads (follow_up_at)
  where deleted_at is null and follow_up_at is not null;

-- The undo affordance and the purge job both ask the same question.
create index leads_deleted_at_idx on public.leads (deleted_at)
  where deleted_at is not null;

-- The background pass claims work with this.
create index leads_enrichment_state_idx on public.leads (enrichment_state, enrichment_queued_at)
  where enrichment_state in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- saved_views — a named filter set.
--
-- `filters` holds the same shape the URL carries, so a view is applied by
-- writing it into the query string and nothing else has to understand it. The
-- alternative — storing SQL — would rot the first time a filter is renamed.
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  filters      jsonb       not null,
  position     integer     not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint saved_views_name_not_blank check (length(btrim(name)) > 0),
  constraint saved_views_filters_is_object check (jsonb_typeof(filters) = 'object')
);

comment on table public.saved_views is
  'Named filter sets for the leads library. Stores the filter state, not SQL, so a view outlives the query builder.';

create unique index saved_views_name_unique_idx on public.saved_views (lower(name));
create index saved_views_position_idx on public.saved_views (position, created_at);

create trigger saved_views_set_updated_at
  before update on public.saved_views
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- leads_library — the library's read model.
--
-- Every filter the operator can apply becomes a top-level column here: the
-- newest audit's measurements are lifted onto the lead, and list membership is
-- folded into an array he can be matched against with a single overlap test.
--
-- The reason is not tidiness. Filtering through a joined table means the query
-- layer has to reach into a related resource, and combining several such
-- filters with OR — "no HTTPS *or* not mobile-friendly" — stops being
-- expressible. Flattening first makes the whole filter set ordinary predicates
-- on one relation, which is also what lets the partial indexes above serve it.
--
-- Deliberately NOT here: place_snapshot and raw. They are large, and no list
-- view has ever needed them.
-- ---------------------------------------------------------------------------
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

  -- The newest audit's measurements, lifted. Null throughout when a lead has
  -- never been audited, which is a distinct filter from any of the faults.
  a.website_status,
  a.is_https,
  a.is_mobile_friendly,
  a.has_meta_description,
  a.load_ms,
  a.copyright_year,
  a.platform,

  ll.list_ids,
  coalesce(n.note_count, 0) as note_count
from public.leads l
  left join public.lead_audits a on a.id = l.latest_audit_id
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
  'Read model for the leads list: lead plus its newest audit measurements plus list membership, so every filter is a predicate on one relation.';

revoke all on public.leads_library from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The purge job — the far end of the undo window.
--
-- In the database rather than a Vercel cron, for the same reason expiry is:
-- a promise that only holds while the app is awake is not a promise. Thirty
-- days is deliberately generous. This is the operator's own work product, not
-- Google's data, so the only clock on it is his own second thoughts.
-- ---------------------------------------------------------------------------
create or replace function public.purge_deleted_leads(p_older_than interval default interval '30 days')
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.leads
   where deleted_at is not null
     and deleted_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_deleted_leads(interval) from public, anon, authenticated;

comment on function public.purge_deleted_leads(interval) is
  'Removes soft-deleted leads past the undo window, cascading their audits, scores, notes and activities. Scheduled nightly.';

-- 03:45 UTC daily, half an hour after the search-results sweep so the two never
-- contend for the same lock.
select cron.schedule(
  'purge-deleted-leads',
  '45 3 * * *',
  $$select public.purge_deleted_leads()$$
);

-- ---------------------------------------------------------------------------
-- Lockdown, extended to the new table. Same three layers as everything else:
-- the app's auth gate is the only authorization there is.
-- ---------------------------------------------------------------------------
alter table public.saved_views enable row level security;

revoke all on public.saved_views from anon, authenticated;
