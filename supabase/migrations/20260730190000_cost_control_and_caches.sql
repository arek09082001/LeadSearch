-- Lead Engine — cost control, and the caches that keep calls from repeating.
--
-- Cost control here is a hard stop, not a report. Three pieces:
--
--   api_usage      the ledger. One row per billable request, written whether
--                  the request succeeded or not, because Google bills a 500
--                  exactly like a 200. This is the only source of truth for
--                  "what have I spent" — the app never adds up its own guesses.
--   app_settings   the ceiling. One row, one number, checked before every call.
--   geocode_cache  a town centre does not move; paying to locate it twice is
--                  waste with no upside.
--
-- Plus `searches.params_hash`, which lets an identical search re-run inside the
-- retention window be answered from `search_results` for nothing at all.

-- ---------------------------------------------------------------------------
-- api_usage — the ledger.
--
-- Both amounts are stored. `list_amount_usd` is what the SKU costs;
-- `billed_amount_usd` is what survived the monthly free allowance. Keeping both
-- means the free tier running out is visible as a change in the second number
-- while the first stays flat, which is exactly the moment the operator needs to
-- notice. Recomputing that later from prices alone would be impossible once a
-- rate card changes.
-- ---------------------------------------------------------------------------
create table public.api_usage (
  id                bigint generated always as identity primary key,

  provider          text        not null,          -- 'google_places'
  sku               text        not null,          -- 'google_places.text_search.enterprise'
  units             integer     not null default 1,

  unit_price_usd    numeric(12, 6) not null,       -- list price per unit, as charged that day
  list_amount_usd   numeric(12, 6) not null,       -- units * unit_price_usd
  free_units        integer     not null default 0,-- units absorbed by the monthly allowance
  billed_amount_usd numeric(12, 6) not null,       -- what this actually costs

  search_id         uuid references public.searches (id) on delete set null,
  occurred_at       timestamptz not null default now(),

  -- Billing months are Google's, so UTC, not the operator's local month. Fixing
  -- the zone is what makes this expression immutable enough to be generated.
  billing_month     date generated always as
                      ((date_trunc('month', (occurred_at at time zone 'UTC')))::date) stored,

  constraint api_usage_units_positive       check (units > 0),
  constraint api_usage_free_units_in_range  check (free_units >= 0 and free_units <= units),
  constraint api_usage_amounts_non_negative check (list_amount_usd >= 0 and billed_amount_usd >= 0)
);

comment on table public.api_usage is
  'Every billable provider request, successful or not. The authoritative record of spend; the UI only ever reads sums from here.';
comment on column public.api_usage.billed_amount_usd is
  'List amount after the monthly free allowance. Diverges from list_amount_usd only once the allowance is exhausted.';

-- The two questions ever asked of this table: what has this month cost, and how
-- much of each SKU's free allowance is left.
create index api_usage_month_sku_idx  on public.api_usage (billing_month, sku);
create index api_usage_occurred_at_idx on public.api_usage (occurred_at desc);
create index api_usage_search_id_idx   on public.api_usage (search_id)
  where search_id is not null;

-- ---------------------------------------------------------------------------
-- app_settings — one row, enforced by the primary key.
--
-- `id boolean primary key check (id)` admits exactly one value, so a second row
-- is a constraint violation rather than a silent second configuration.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                  boolean     primary key default true,
  -- Zero by choice, not as a placeholder: the default posture is free-tier only.
  -- The guard always authorises a call that costs nothing, so a $0 ceiling
  -- spends Google's 1,000 free Text Search calls a month — around 20,000
  -- businesses — and then stops dead rather than starting an invoice. Raising it
  -- is a deliberate act, which is the point.
  monthly_ceiling_usd numeric(10, 2) not null default 0.00,
  updated_at          timestamptz not null default now(),

  constraint app_settings_single_row     check (id),
  constraint app_settings_ceiling_positive check (monthly_ceiling_usd >= 0)
);

comment on table public.app_settings is
  'Single-row configuration. monthly_ceiling_usd is a hard stop: the server refuses billable calls once the month exceeds it.';

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- geocode_cache — typed location text to a point.
--
-- Expires at 30 days to stay inside Google's caching allowance for geocoding
-- results, the same window `search_results` uses. Keyed on the normalised query
-- so "Heilbronn", " heilbronn " and "HEILBRONN" are one cache entry.
-- ---------------------------------------------------------------------------
create table public.geocode_cache (
  query_norm        text        primary key,
  lat               double precision not null,
  lng               double precision not null,
  formatted_address text,
  provider          text        not null default 'google_places',
  fetched_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days'),

  constraint geocode_cache_expiry_after_fetch check (expires_at > fetched_at)
);

comment on table public.geocode_cache is
  'Resolved location text. Expires on the same 30-day clock as search_results — it is Google-sourced data like any other.';

create index geocode_cache_expires_at_idx on public.geocode_cache (expires_at);

-- ---------------------------------------------------------------------------
-- searches.params_hash — the key that makes a repeat search free.
--
-- Two searches with the same hash asked the same question. If the first one's
-- results have not expired yet, the second can be served from them without
-- touching Google. Nullable because history predating this column has no hash
-- and must not be resurrected as a false cache hit.
-- ---------------------------------------------------------------------------
alter table public.searches
  add column params_hash text;

comment on column public.searches.params_hash is
  'Stable hash of the normalised request. A later identical search replays this one''s results instead of paying again.';

create index searches_params_hash_ran_at_idx
  on public.searches (params_hash, ran_at desc)
  where params_hash is not null;

-- ---------------------------------------------------------------------------
-- Expiry for the new cache, on the same principle as search_results: it runs in
-- the database so the compliance promise does not depend on the app being up.
-- ---------------------------------------------------------------------------
create or replace function public.expire_geocode_cache()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.geocode_cache where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.expire_geocode_cache() from public, anon, authenticated;

comment on function public.expire_geocode_cache() is
  'Deletes Google-sourced geocoding results past their retention window. Scheduled nightly via pg_cron.';

-- 03:20 UTC, five minutes after the search-result sweep.
select cron.schedule(
  'expire-geocode-cache',
  '20 3 * * *',
  $$select public.expire_geocode_cache()$$
);

-- ---------------------------------------------------------------------------
-- Month-to-date spend, per SKU.
--
-- A function rather than a client-side sum because supabase-js cannot GROUP BY,
-- and because the free-allowance check runs before *every* billable call — it
-- has to be one indexed round trip, not a page of rows to add up in JavaScript.
-- ---------------------------------------------------------------------------
create or replace function public.api_usage_month_to_date(p_month date default null)
returns table (sku text, units bigint, list_usd numeric, billed_usd numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.sku,
         sum(u.units)::bigint            as units,
         sum(u.list_amount_usd)::numeric as list_usd,
         sum(u.billed_amount_usd)::numeric as billed_usd
    from public.api_usage u
   where u.billing_month = coalesce(
           p_month,
           (date_trunc('month', (now() at time zone 'UTC')))::date
         )
   group by u.sku;
$$;

revoke all on function public.api_usage_month_to_date(date) from public, anon, authenticated;

comment on function public.api_usage_month_to_date(date) is
  'Per-SKU spend for a billing month, defaulting to the current UTC month. Backs both the ceiling check and the running total in the UI.';

-- ---------------------------------------------------------------------------
-- Lockdown, extended to the new tables.
--
-- The ALTER DEFAULT PRIVILEGES from the original lockdown already keeps
-- anon/authenticated off anything created since, and schema USAGE is still
-- revoked. RLS is the one layer that must be switched on per table.
-- ---------------------------------------------------------------------------
alter table public.api_usage     enable row level security;
alter table public.app_settings  enable row level security;
alter table public.geocode_cache enable row level security;

-- Deliberately no policies, as before: only the service role reaches these.
