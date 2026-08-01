-- Lead Engine — what to say when they pick up.
--
-- Everything before this migration answers "is this business worth phoning".
-- The book is ranked, the diagnosis is written, the evidence is under every
-- claim. None of it answers the question the operator actually has at the
-- moment he dials, which is what the first sentence out of his mouth should be.
--
-- Three tables, and they fall on both sides of the split this schema has drawn
-- since the first migration:
--
--   1. place_review_fetches / place_reviews — TRANSIENT. Google content, on a
--      clock, deleted by a scheduled job exactly like search_results.
--   2. call_briefings                       — PERMANENT. The operator's own
--      work product, kept for as long as the lead is.
--
-- WHY REVIEWS ARE FETCHED HERE AND NOT WITH EVERYTHING ELSE. Google prices a
-- Places request at the most expensive field in its mask, and `reviews` is an
-- Enterprise + Atmosphere field. Adding it to the Place Details mask the rest of
-- the app uses would lift every save and every nightly refresh into the top
-- band — for a book of a thousand leads, of which perhaps forty are ever rung.
-- So reviews are their own call, made once, seconds before the phone is picked
-- up, and billed through api_usage like everything else. The arithmetic is then
-- the operator's own: refreshing the book costs what refreshing the book costs,
-- and reviews cost one request each time he decides to phone somebody.
--
-- ON THE PEOPLE WHO WROTE THEM. Google returns an author's display name, photo
-- and profile link with every review. None of it is stored, for the same reason
-- the Impressum check does not extract the natural person it is legally certain
-- to find: the operator needs to know that three reviews mention the parking,
-- not who mentioned it. There is no column here for a name, so there is no way
-- for one to arrive by accident.

-- ---------------------------------------------------------------------------
-- place_review_fetches — that we asked, and when.
--
-- A second table earns its place by answering one question the review rows
-- cannot: "does this business have no reviews, or has nobody looked?" Those two
-- states look identical in an empty result set and they cost differently — the
-- first should never be asked about again inside the retention window, the
-- second must be. Without this table every prepare for a business with no
-- reviews would spend a fresh Enterprise + Atmosphere request to rediscover
-- that there is nothing there.
--
-- It is exactly the shape `searches` has over `search_results`: the fetch is the
-- parent, its rows hang off it, and expiring the parent takes the content with
-- it. Unlike `searches` it holds no Google content at all — a place id, two
-- timestamps and a count — which is what lets it outlive the reviews it counted
-- if a sweep ever runs between them.
-- ---------------------------------------------------------------------------
create table public.place_review_fetches (
  google_place_id text        primary key,   -- the one Google field we may keep

  fetched_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '30 days'),

  -- What came back. Zero is a real answer and the reason this table exists.
  review_count    integer     not null default 0,

  constraint place_review_fetches_count_non_negative
    check (review_count >= 0),
  constraint place_review_fetches_expiry_after_fetch
    check (expires_at > fetched_at)
);

comment on table public.place_review_fetches is
  'One row per business whose reviews have been fetched. Exists so that "no reviews" and "never asked" are distinguishable, which is the difference between a free page load and a billable request.';
comment on column public.place_review_fetches.review_count is
  'How many reviews came back, including zero. Not derivable from place_reviews once those rows expire, and zero is the answer this table was added for.';
comment on column public.place_review_fetches.expires_at is
  'Enforced by the scheduled cleanup job, not by Postgres. Same 30-day window as search_results, and for the same reason: it is Google content, held under Google''s terms.';

create index place_review_fetches_expires_at_idx
  on public.place_review_fetches (expires_at);

-- ---------------------------------------------------------------------------
-- place_reviews — the words, on the same clock as everything else Google sells.
--
-- `review_rank` preserves the order Google returned them in. Google's default
-- ordering is its own idea of relevance, and re-sorting by date or by rating
-- here would quietly turn "their most prominent reviews" into something else —
-- which is not what the operator will be looking at on his phone when he checks.
-- ---------------------------------------------------------------------------
create table public.place_reviews (
  id                 uuid        primary key default gen_random_uuid(),
  google_place_id    text        not null
                       references public.place_review_fetches (google_place_id)
                       on delete cascade,

  provider_review_id text        not null,   -- Google's review resource name
  review_rank        integer     not null,   -- position as returned, 0-based

  rating             integer,
  -- The review as the customer wrote it, never Google's translation of it.
  body               text,
  language_code      text,
  published_at       timestamptz,
  -- Google's own phrasing of the age — "a month ago" — kept verbatim because it
  -- is what the operator would say out loud, and because it survives the
  -- publish time being absent.
  relative_age       text,

  fetched_at         timestamptz not null default now(),
  expires_at         timestamptz not null default (now() + interval '30 days'),

  constraint place_reviews_unique_per_place
    unique (google_place_id, provider_review_id),
  constraint place_reviews_rating_range
    check (rating is null or (rating >= 1 and rating <= 5)),
  constraint place_reviews_expiry_after_fetch
    check (expires_at > fetched_at)
);

comment on table public.place_reviews is
  'Volatile Google review content with a hard expiry, fetched only when a call is being prepared. Deliberately holds nothing about the author.';
comment on column public.place_reviews.body is
  'The review text as written. Google will translate a review into the request language and return the original beside it; the original is what is stored, because the operator is ringing a German business about German reviews.';
comment on column public.place_reviews.review_rank is
  'Position in the order Google returned, 0-based. Preserved rather than re-sorted: the ordering is Google''s notion of prominence, which is what the owner sees on their own listing.';

create index place_reviews_place_rank_idx
  on public.place_reviews (google_place_id, review_rank);
create index place_reviews_expires_at_idx
  on public.place_reviews (expires_at);

-- ---------------------------------------------------------------------------
-- expire_place_reviews — the retention promise, kept by the database.
--
-- In the database rather than in a Vercel cron for the reason the search-result
-- job gives: if the app goes dark for a month, Google content still expires.
--
-- Parents first, so the cascade does the bulk of the work and the second delete
-- only ever catches a row whose expiry was written by hand. Deleting the rows
-- first and the parents second would leave, for the length of one statement, a
-- fetch row claiming three reviews with none behind it — which is the one state
-- the reader must never see, because it reads as "asked recently, found none".
-- ---------------------------------------------------------------------------
create or replace function public.expire_place_reviews()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
  v_orphans integer;
begin
  delete from public.place_review_fetches where expires_at < now();
  get diagnostics v_deleted = row_count;

  delete from public.place_reviews where expires_at < now();
  get diagnostics v_orphans = row_count;

  return v_deleted + v_orphans;
end;
$$;

revoke all on function public.expire_place_reviews() from public, anon, authenticated;

comment on function public.expire_place_reviews() is
  'Deletes Google-sourced review content past its retention window. Scheduled nightly via pg_cron, alongside the search-result and geocode jobs.';

-- 03:25 UTC daily — between the search results (03:15) and the geocodes (03:20)
-- would be neater, but those two are already scheduled and moving them would
-- rewrite a finished migration. Five minutes later costs nothing.
select cron.schedule(
  'expire-place-reviews',
  '25 3 * * *',
  $$select public.expire_place_reviews()$$
);

-- ---------------------------------------------------------------------------
-- call_briefings — the permanent half.
--
-- Append-only, exactly like lead_scores, and for the same reason: a briefing is
-- an artefact of a moment. It was written from one audit, one score and one set
-- of reviews, and six weeks later the operator is entitled to know which. A
-- table that updated in place would answer "what does the assistant say now",
-- which is a question nobody asks while holding a phone.
--
-- BOTH SIDES ARE STORED. `input` is what the provider was given; `briefing` is
-- what it gave back. Keeping the input is what makes a briefing arguable rather
-- than merely present — the same reason `lead_scores.factors` keeps the
-- arithmetic instead of only the number. It also means a bad briefing can be
-- re-run against a changed prompt without going back to Google for anything.
--
-- `provider` and `model` are stamped for the same reason `checker_version` is:
-- the mock that writes these today is not the model that will write them later,
-- and a briefing read cold must say which one it came from.
-- ---------------------------------------------------------------------------
create table public.call_briefings (
  id              uuid        primary key default gen_random_uuid(),
  lead_id         uuid        not null references public.leads (id) on delete cascade,

  -- The diagnosis it was written from. `on delete set null` rather than cascade:
  -- an audit can be pruned, and a briefing that outlived its audit is still a
  -- record of what was said — `diagnosis_as_of` keeps it explainable.
  audit_id        uuid        references public.lead_audits (id) on delete set null,
  score_id        uuid        references public.lead_scores (id) on delete set null,

  provider        text        not null,      -- 'mock' until a model is wired in
  model           text,                      -- null for a provider with no model

  input           jsonb       not null,      -- what the provider was handed
  briefing        jsonb       not null,      -- opener, hooks, evidence, objections, avoid

  -- Three ages, because a briefing is only as current as its worst input and
  -- the surface has to be able to say so. PRODUCT.md's fifth principle applied
  -- to a thing that is itself derived from three dated sources.
  diagnosis_as_of timestamptz,
  google_as_of    timestamptz,
  reviews_as_of   timestamptz,
  review_count    integer     not null default 0,

  created_at      timestamptz not null default now(),

  constraint call_briefings_review_count_non_negative check (review_count >= 0)
);

comment on table public.call_briefings is
  'What to open the call with, generated from the diagnosis. Append-only: a briefing is an artefact of the moment it was written, and the moment is half the record.';
comment on column public.call_briefings.input is
  'The exact structured input the provider was given, built by a pure function. Stored so a briefing can be argued with, and re-run under a different prompt without a second Google request.';
comment on column public.call_briefings.diagnosis_as_of is
  'When the audit this was written from ran. The number that decides whether a briefing is still worth reading, and it is not the same as created_at.';

-- The only question ever asked of this table: what is the newest briefing for
-- this lead. Everything older is history, read the same way audits are.
create index call_briefings_lead_id_created_at_idx
  on public.call_briefings (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Lockdown. The three tables are new, so the blanket revokes in
-- 20260730180300_lockdown.sql ran before they existed. The default privileges
-- set there stop anon/authenticated inheriting anything; these lines are the
-- belt to that pair of braces, and they are what the first migration promised
-- for every table added afterwards.
-- ---------------------------------------------------------------------------
alter table public.place_review_fetches enable row level security;
alter table public.place_reviews        enable row level security;
alter table public.call_briefings       enable row level security;

revoke all on public.place_review_fetches from anon, authenticated;
revoke all on public.place_reviews        from anon, authenticated;
revoke all on public.call_briefings       from anon, authenticated;
