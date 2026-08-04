-- Lead Engine — the MCP surface, and the memory that keeps it cheap.
--
-- `search_places` and `save_leads` are the two tools an assistant drives this
-- product with. They differ from every other door into the data in one way that
-- shapes this whole file: NOBODY IS WATCHING WHEN THEY RUN. A search from the
-- browser puts sixty rows on a screen and a person decides; a search from a
-- tool call decides on its own, saves what it decides, and reports afterwards.
--
-- Three things follow, and they are the three things this migration adds.
--
--   1. What the tool decided has to be visible on the lead itself. `lead_type`
--      and `weakness_signals` are that: why this business is in the book, in
--      the row rather than in a log nobody reads. PRODUCT.md's fourth principle
--      is cold recall, and "I have no idea why this is here" fails it.
--
--   2. What the tool THREW AWAY has to be remembered, or the next run pays to
--      throw it away again. `skipped_places` is the memo, and its whole value
--      is quota that is not spent twice.
--
--   3. What the tool spent has to be countable. `mcp_call_log` is the ledger
--      for the one resource `api_usage` cannot see — the website checks, which
--      cost no money and are still a budget, because they are requests made to
--      strangers' servers in somebody's name.

-- ---------------------------------------------------------------------------
-- lead_type — why this business is in the book.
--
-- An enum, and per the vocabulary policy in 20260730180000 that is a claim:
-- this list is DECIDED. Three ways a lead gets here and there is no fourth
-- pending an argument.
--
--   no_website     Google reported no site at all. The whole product thesis;
--                  saved on sight, with nothing further to check.
--   weak_website   A site exists and something is wrong with it. Only saved
--                  because a check found a named fault — see weakness_signals.
--   manual         A person decided. Everything saved from the Search surface,
--                  everything backfilled through `save_leads`, and every lead
--                  that existed before this migration ran.
--
-- `manual` is the default on purpose. It is the honest answer for a row nobody
-- can now ask about, and it is the correct answer for the save path the
-- operator drives by hand — which is still the ordinary one.
-- ---------------------------------------------------------------------------
create type public.lead_type as enum (
  'no_website',
  'weak_website',
  'manual'
);

alter table public.leads
  add column lead_type public.lead_type not null default 'manual';

comment on column public.leads.lead_type is
  'Why this lead is in the library. no_website and weak_website are decisions search_places made unattended; manual is a person, including every lead saved before this column existed.';

-- ---------------------------------------------------------------------------
-- weakness_signals — what the check actually found.
--
-- NOT an enum, and for the reason the audit's check codes are not one: the list
-- of things that can be wrong with a website is open, and encoding it in the
-- type system would make adding a signal a migration.
--
-- The values are `FindingCode` strings from lib/enrichment/vocabulary.ts —
-- `no_https`, `not_mobile_friendly`, `stale_copyright` and so on — deliberately
-- the SAME vocabulary the full audit writes into lead_audit_findings, rather
-- than a second private one. The cheap triage check and the expensive audit
-- find the same faults with different instruments, and a lead that was saved
-- for `no_https` should still say `no_https` after the audit has confirmed it.
-- Two lists here would be a correctness bug wearing a naming bug's clothes.
--
-- Empty for `no_website` (nothing was checked) and for `manual` (nobody
-- checked). Not null, so "no signals" is `{}` and never a null to branch on.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column weakness_signals text[] not null default '{}';

comment on column public.leads.weakness_signals is
  'Faults found by the pre-save website check, as FindingCode strings shared with lead_audit_findings. Empty unless lead_type is weak_website.';

-- Partial: the only question ever asked of this column is "which leads did the
-- tool save, and why" — a small slice of a library expected to reach thousands.
create index leads_lead_type_idx on public.leads (lead_type)
  where lead_type <> 'manual';

-- ---------------------------------------------------------------------------
-- skipped_places — the businesses that were looked at and not kept.
--
-- Three columns, and the shape is a compliance position as much as a product
-- one. Google's terms single out the place ID as the one field that may be
-- retained indefinitely; everything else about a business we chose NOT to keep
-- would be exactly the long-term retention the licence forbids. So: the id, the
-- reason, the date. No name, no address, no rating. A row here is a decision
-- about a business, not a record of one.
--
-- What it buys: `search_places` reads this before it spends anything. A
-- business rejected last week costs nothing to reject again — no Places field,
-- no website fetch, no seconds. Over a market worked repeatedly, that is most
-- of the quota.
--
-- What it costs: a business that gets worse is invisible. A site that was fine
-- in August and abandoned by March will not be looked at again, because this
-- table says the question is settled. `checked_at` is stored so that judgement
-- can be revisited, and `save_leads` deletes the row outright — which is the
-- documented way back in, and the reason 4b exists at all.
-- ---------------------------------------------------------------------------
create table public.skipped_places (
  place_id   text        primary key,
  -- Free text by design, same argument as weakness_signals: the set of reasons
  -- to reject a business will grow, and each growth must not be a migration.
  -- See SKIP_REASONS in lib/mcp/vocabulary.ts for the closed list the code uses.
  reason     text        not null,
  checked_at timestamptz not null default now()
);

comment on table public.skipped_places is
  'Place IDs search_places examined and rejected, so the next run does not pay to reject them again. Place ID only: the one Google field that may be retained indefinitely. save_leads deletes a row here when the operator overrules the decision.';
comment on column public.skipped_places.checked_at is
  'When the decision was made. Stored so a stale rejection can be revisited; nothing expires on its own.';

create index skipped_places_checked_at_idx on public.skipped_places (checked_at desc);

-- ---------------------------------------------------------------------------
-- mcp_call_log — what the assistant did, and what it spent doing it.
--
-- `api_usage` already holds every billable request, so this is not a second
-- money ledger and must not become one. It answers the questions api_usage
-- cannot:
--
--   - How many WEBSITE CHECKS did that run make? Those cost no money and are
--     still a budget. They are HTTP requests to small businesses' servers,
--     made unattended, in the operator's name. An unbounded loop that visits
--     four hundred sites because a tool call asked for sixty results twice is
--     not a billing problem, it is a manners problem, and the only way to bound
--     it is to count it.
--   - What did the tool decide, and how much of it was thrown away? A run that
--     saves nothing out of sixty is either a well-worked market or a broken
--     rule, and the two look identical without the counts.
--
-- `site_checks` is the load-bearing column: the daily allowance in
-- app_settings.mcp_site_check_daily_limit is enforced by summing it over the
-- current UTC day. The ledger is authoritative, exactly as it is for money —
-- nothing trusts a counter held in a process that a serverless platform may
-- discard between two tool calls.
-- ---------------------------------------------------------------------------
create table public.mcp_call_log (
  id            bigint      generated always as identity primary key,

  tool          text        not null,          -- 'search_places' | 'save_leads'
  -- What was asked for, verbatim, so a surprising result can be re-read against
  -- the arguments that produced it rather than against a summary of them.
  params        jsonb,

  saved_count   integer     not null default 0,
  skipped_count integer     not null default 0,
  -- Requests to Google. Duplicated from api_usage on purpose: this row is the
  -- account of one tool call and has to be readable without a join.
  places_calls  integer     not null default 0,
  -- Requests to strangers' web servers. Nothing else counts these.
  site_checks   integer     not null default 0,

  duration_ms   integer,
  -- Named, never "something went wrong". The operator is also the developer.
  error         text,

  search_id     uuid        references public.searches (id) on delete set null,
  called_at     timestamptz not null default now(),

  constraint mcp_call_log_counts_positive check (
    saved_count >= 0 and skipped_count >= 0 and places_calls >= 0 and site_checks >= 0
  )
);

comment on table public.mcp_call_log is
  'One row per MCP tool call. Not a money ledger — api_usage is that. This counts the resource api_usage cannot see: website checks, which cost nothing and are still bounded.';
comment on column public.mcp_call_log.site_checks is
  'Website fetches this call made. Summed over the UTC day to enforce app_settings.mcp_site_check_daily_limit.';

create index mcp_call_log_called_at_idx on public.mcp_call_log (called_at desc);

-- ---------------------------------------------------------------------------
-- The third ceiling, and why it is a count rather than a price.
--
-- monthly_ceiling_usd bounds Google. assistant_ceiling_usd bounds the model.
-- Neither can bound this, because a website check costs zero dollars — it is
-- free in exactly the way that makes it dangerous to leave unbounded.
--
-- 50 a day, and unlike the other two this default is NOT zero. The argument
-- that makes zero right for money is that the expensive behaviour must be asked
-- for by name; here the behaviour is free and the failure mode of zero would be
-- a tool that silently never checks a website and therefore never saves a
-- weak_website lead — half the feature, off by default, looking like a bug.
-- Fifty is roughly one worked market a day and small enough that a runaway loop
-- stops before anybody notices it at the other end.
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column mcp_site_check_daily_limit integer not null default 50;

alter table public.app_settings
  add constraint app_settings_site_check_limit_positive
  check (mcp_site_check_daily_limit >= 0);

comment on column public.app_settings.mcp_site_check_daily_limit is
  'How many websites search_places may fetch per UTC day. Not a price — a manners bound on unattended requests to other people''s servers. Enforced by summing mcp_call_log.site_checks.';

-- ---------------------------------------------------------------------------
-- Lockdown. Both tables are new, so the blanket revokes in
-- 20260730180300_lockdown.sql ran before they existed. The default privileges
-- set there stop anon/authenticated inheriting anything; these lines are the
-- belt to that pair of braces, and they are what the first migration promised
-- for every table added afterwards.
-- ---------------------------------------------------------------------------
alter table public.skipped_places enable row level security;
alter table public.mcp_call_log   enable row level security;

revoke all on public.skipped_places from anon, authenticated;
revoke all on public.mcp_call_log   from anon, authenticated;
