-- Lead Engine — TRANSIENT side of the split.
--
-- Nothing in this file is the owner's work product. `searches` is his own query
-- history and keeps forever; `search_results` holds Google-sourced Place data
-- and is deleted on a schedule. A row here is a candidate, never a lead.

-- ---------------------------------------------------------------------------
-- searches — query history. Contains no Google content, only what was asked.
-- ---------------------------------------------------------------------------
create table public.searches (
  id                 uuid primary key default gen_random_uuid(),

  -- what was asked
  query              text        not null,
  location_text      text,                       -- as typed, e.g. "Neuss, DE"
  location_lat       double precision,           -- resolved centre
  location_lng       double precision,
  radius_m           integer,
  category           text,                       -- Places type filter, if any

  -- how it went
  provider           text        not null default 'google_places',
  ran_at             timestamptz not null default now(),
  result_count       integer     not null default 0,
  estimated_cost_usd numeric(10, 4),             -- Places SKUs bill per request
  request_params     jsonb,                      -- exact params sent, for replay
  error              text,                       -- set when the call failed

  created_at         timestamptz not null default now(),

  constraint searches_radius_positive
    check (radius_m is null or radius_m > 0),
  constraint searches_result_count_non_negative
    check (result_count >= 0)
);

comment on table public.searches is
  'Query history. Transient by category but retained: it holds no Google content, only what the operator asked for.';

create index searches_ran_at_idx on public.searches (ran_at desc);

-- ---------------------------------------------------------------------------
-- search_results — Google Place payloads, on a clock.
--
-- Deliberately has NO pointer to leads. "Already saved?" is answered by joining
-- on google_place_id against the unique index on leads, which keeps the
-- transient side from holding a reference into the permanent side.
-- ---------------------------------------------------------------------------
create table public.search_results (
  id                uuid        primary key default gen_random_uuid(),
  search_id         uuid        not null references public.searches (id) on delete cascade,

  google_place_id   text        not null,        -- the one field Google lets us keep
  result_rank       integer,                     -- position within the result set

  -- volatile Google fields, valid only as of fetched_at
  name              text,
  formatted_address text,
  lat               double precision,
  lng               double precision,
  phone             text,
  website           text,
  rating            numeric(2, 1),
  user_rating_count integer,
  business_status   text,
  primary_type      text,
  types             text[],
  google_maps_uri   text,
  raw               jsonb,                       -- full Place payload as returned

  fetched_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days'),

  constraint search_results_unique_place_per_search
    unique (search_id, google_place_id),
  constraint search_results_rating_range
    check (rating is null or (rating >= 0 and rating <= 5)),
  constraint search_results_expiry_after_fetch
    check (expires_at > fetched_at)
);

comment on table public.search_results is
  'Volatile Google Places data with a hard expiry. A row here is a candidate, not a lead; the cleanup job deletes it and nothing is lost.';
comment on column public.search_results.expires_at is
  'Enforced by the scheduled cleanup job, not by Postgres. Default window: 30 days, the outer edge of Google''s caching guidance.';

create index search_results_search_id_rank_idx
  on public.search_results (search_id, result_rank);
create index search_results_expires_at_idx
  on public.search_results (expires_at);
create index search_results_google_place_id_idx
  on public.search_results (google_place_id);
