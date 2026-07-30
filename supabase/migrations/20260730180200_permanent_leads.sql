-- Lead Engine — PERMANENT side of the split.
--
-- Everything here survives indefinitely. Google-sourced columns on `leads` are a
-- snapshot carrying its own fetched_at and a refresh path; every other column is
-- the owner's own work product and never expires with it.

-- ---------------------------------------------------------------------------
-- leads — businesses explicitly saved. google_place_id is the identity.
-- ---------------------------------------------------------------------------
create table public.leads (
  id                  uuid primary key default gen_random_uuid(),

  -- identity: saving the same business from two searches updates one row.
  google_place_id     text        not null unique,

  -- ---- snapshot of Google data, valid only as of fetched_at ----------------
  name                text        not null,
  formatted_address   text,
  city                text,                       -- extracted for grouping/filtering
  region              text,
  postal_code         text,
  country_code        text,
  lat                 double precision,
  lng                 double precision,
  phone               text,
  website             text,
  rating              numeric(2, 1),
  user_rating_count   integer,
  business_status     text,
  primary_type        text,
  types               text[],
  google_maps_uri     text,
  place_snapshot      jsonb,
  fetched_at          timestamptz not null default now(),

  -- ---- the owner's own fields, which never expire -------------------------
  status              public.lead_status not null default 'new',
  follow_up_at        date,
  saved_at            timestamptz not null default now(),
  discovered_via_search_id uuid references public.searches (id) on delete set null,

  -- Denormalised pointers to the newest audit and score. Maintained by trigger,
  -- never written by the app. They exist so the leads list can sort and filter
  -- thousands of rows by score or audit outcome without a lateral join.
  current_score       smallint,
  current_score_id    uuid,
  scored_at           timestamptz,
  latest_audit_id     uuid,
  last_audited_at     timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint leads_rating_range
    check (rating is null or (rating >= 0 and rating <= 5))
);

comment on table public.leads is
  'Businesses the operator explicitly saved. Permanent. Google-sourced columns are a snapshot qualified by fetched_at; owner-authored columns outlive it.';
comment on column public.leads.fetched_at is
  'Age of the Google snapshot above it. Any surface showing those fields must be able to state this.';
comment on column public.leads.current_score is
  'Denormalised from the newest lead_scores row by trigger. Do not write directly.';

create index leads_status_idx           on public.leads (status);
create index leads_current_score_idx    on public.leads (current_score desc nulls last);
create index leads_saved_at_idx         on public.leads (saved_at desc);
create index leads_city_idx             on public.leads (city);
-- Partial: the Outreach queue only ever asks for leads that have a date set.
create index leads_follow_up_at_idx     on public.leads (follow_up_at)
  where follow_up_at is not null;
-- Fuzzy search-within-leads.
create index leads_name_trgm_idx        on public.leads using gin (name gin_trgm_ops);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_audits — one row per website audit run. History is the point: it is how
-- you see that someone finally fixed their site.
--
-- The header holds only what is certain. The criteria themselves live in
-- lead_audit_findings as data, because PRODUCT.md marks them undecided.
-- ---------------------------------------------------------------------------
create table public.lead_audits (
  id              uuid        primary key default gen_random_uuid(),
  lead_id         uuid        not null references public.leads (id) on delete cascade,

  audited_at      timestamptz not null default now(),
  checker_version text        not null,           -- which auditor produced this
  website_url     text,                           -- the URL actually audited
  final_url       text,                           -- after redirects
  website_status  public.website_status not null,
  http_status     smallint,
  duration_ms     integer,
  error           text,                           -- set when website_status = 'error'
  raw             jsonb,                          -- full checker output

  created_at      timestamptz not null default now()
);

comment on table public.lead_audits is
  'Append-only audit history. checker_version keeps an old audit explainable after the auditor changes.';

create index lead_audits_lead_id_audited_at_idx
  on public.lead_audits (lead_id, audited_at desc);
create index lead_audits_website_status_idx
  on public.lead_audits (website_status);

-- ---------------------------------------------------------------------------
-- lead_audit_findings — structured, filterable findings. Not a text blob.
--
-- `code` is text, not an enum: the check vocabulary is open, and adding a check
-- must not require a migration. Filtering leads by finding is
--   join lead_audit_findings f on f.audit_id = leads.latest_audit_id
--   where f.code = '...' and not f.passed
-- ---------------------------------------------------------------------------
create table public.lead_audit_findings (
  id        bigint generated always as identity primary key,
  audit_id  uuid    not null references public.lead_audits (id) on delete cascade,

  code      text    not null,                     -- e.g. 'no_https', 'no_meta_description'
  category  text,                                 -- e.g. 'seo', 'mobile', 'trust'
  severity  public.audit_severity not null default 'info',
  passed    boolean not null,
  value     jsonb,                                -- measured evidence, e.g. {"lcp_ms": 4200}
  message   text,                                 -- one-line human summary for the UI

  constraint lead_audit_findings_unique_code_per_audit
    unique (audit_id, code)
);

comment on table public.lead_audit_findings is
  'One row per check per audit. Findings are data, so new criteria need no schema change.';

create index lead_audit_findings_audit_id_idx on public.lead_audit_findings (audit_id);
create index lead_audit_findings_code_idx     on public.lead_audit_findings (code);
-- The only question the leads list asks: which checks did this site FAIL?
create index lead_audit_findings_failed_idx
  on public.lead_audit_findings (code, severity)
  where passed = false;

-- ---------------------------------------------------------------------------
-- lead_scores — score plus the breakdown that produced it, versioned by config.
-- ---------------------------------------------------------------------------
create table public.lead_scores (
  id             uuid        primary key default gen_random_uuid(),
  lead_id        uuid        not null references public.leads (id) on delete cascade,
  audit_id       uuid        references public.lead_audits (id) on delete set null,

  score          smallint    not null,
  config_version text        not null,            -- so old scores stay explainable
  factors        jsonb       not null,            -- [{key, label, weight, raw, contribution}]
  computed_at    timestamptz not null default now(),

  constraint lead_scores_score_range check (score >= 0 and score <= 100)
);

comment on table public.lead_scores is
  'Append-only. A score is never edited; a re-score is a new row, so history stays readable under an old config.';

create index lead_scores_lead_id_computed_at_idx
  on public.lead_scores (lead_id, computed_at desc);
create index lead_scores_config_version_idx
  on public.lead_scores (config_version);

-- Close the denormalisation loop now that both targets exist.
alter table public.leads
  add constraint leads_current_score_id_fkey
    foreign key (current_score_id) references public.lead_scores (id) on delete set null,
  add constraint leads_latest_audit_id_fkey
    foreign key (latest_audit_id) references public.lead_audits (id) on delete set null;

-- ---------------------------------------------------------------------------
-- lead_notes — freeform, timestamped.
-- ---------------------------------------------------------------------------
create table public.lead_notes (
  id         uuid        primary key default gen_random_uuid(),
  lead_id    uuid        not null references public.leads (id) on delete cascade,
  body       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lead_notes_body_not_blank check (length(btrim(body)) > 0)
);

create index lead_notes_lead_id_created_at_idx
  on public.lead_notes (lead_id, created_at desc);

create trigger lead_notes_set_updated_at
  before update on public.lead_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_activities — the outreach log: what I did, when.
-- ---------------------------------------------------------------------------
create table public.lead_activities (
  id            bigint generated always as identity primary key,
  lead_id       uuid        not null references public.leads (id) on delete cascade,

  type          public.activity_type not null,
  occurred_at   timestamptz not null default now(),
  summary       text,

  -- populated on 'status_change' rows, written by trigger
  status_before public.lead_status,
  status_after  public.lead_status,

  created_at    timestamptz not null default now()
);

comment on table public.lead_activities is
  'Outreach log. Status transitions are appended automatically so a lead read cold two months later still explains itself.';

create index lead_activities_lead_id_occurred_at_idx
  on public.lead_activities (lead_id, occurred_at desc);
create index lead_activities_occurred_at_idx
  on public.lead_activities (occurred_at desc);

-- ---------------------------------------------------------------------------
-- lists / lead_lists — grouping by city, campaign, vertical.
-- ---------------------------------------------------------------------------
create table public.lists (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint lists_name_not_blank check (length(btrim(name)) > 0)
);

-- Case-insensitive uniqueness: "Neuss" and "neuss" are the same list.
create unique index lists_name_unique_idx on public.lists (lower(name));

create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function public.set_updated_at();

create table public.lead_lists (
  list_id  uuid        not null references public.lists (id) on delete cascade,
  lead_id  uuid        not null references public.leads (id) on delete cascade,
  added_at timestamptz not null default now(),

  primary key (list_id, lead_id)
);

create index lead_lists_lead_id_idx on public.lead_lists (lead_id);

-- ---------------------------------------------------------------------------
-- Triggers that maintain the denormalised pointers on leads.
--
-- Both recompute from scratch rather than trusting NEW, so INSERT, UPDATE and
-- DELETE all converge on the truth.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_lead_score_cache()
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

  update public.leads l
     set current_score    = s.score,
         current_score_id = s.id,
         scored_at        = s.computed_at
    from (
      select id, score, computed_at
        from public.lead_scores
       where lead_id = v_lead_id
       order by computed_at desc, id desc
       limit 1
    ) s
   where l.id = v_lead_id;

  if not found then
    update public.leads
       set current_score = null, current_score_id = null, scored_at = null
     where id = v_lead_id;
  end if;

  return null;
end;
$$;

create trigger lead_scores_refresh_cache
  after insert or update or delete on public.lead_scores
  for each row execute function public.refresh_lead_score_cache();

create or replace function public.refresh_lead_audit_cache()
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

  update public.leads l
     set latest_audit_id = a.id,
         last_audited_at = a.audited_at
    from (
      select id, audited_at
        from public.lead_audits
       where lead_id = v_lead_id
       order by audited_at desc, id desc
       limit 1
    ) a
   where l.id = v_lead_id;

  if not found then
    update public.leads
       set latest_audit_id = null, last_audited_at = null
     where id = v_lead_id;
  end if;

  return null;
end;
$$;

create trigger lead_audits_refresh_cache
  after insert or update or delete on public.lead_audits
  for each row execute function public.refresh_lead_audit_cache();

-- Status changes write themselves into the outreach log.
create or replace function public.log_lead_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.lead_activities (lead_id, type, occurred_at, status_before, status_after)
    values (new.id, 'status_change', now(), old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger leads_log_status_change
  after update of status on public.leads
  for each row execute function public.log_lead_status_change();

revoke all on function public.refresh_lead_score_cache()  from public, anon, authenticated;
revoke all on function public.refresh_lead_audit_cache()  from public, anon, authenticated;
revoke all on function public.log_lead_status_change()    from public, anon, authenticated;
