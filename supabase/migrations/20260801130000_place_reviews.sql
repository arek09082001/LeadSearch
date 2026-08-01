-- Lead Engine — what their customers said, bought once per call.
--
-- The migration before this one gave the assistant somewhere to put a briefing.
-- This one gives it the last input it was missing: the business's own reviews,
-- which are the only thing a call briefing is built from that is neither a
-- measurement this tool took nor a judgement this tool made. They are what the
-- owner reads about himself, and they are the half of the conversation he did
-- not write.
--
-- WHY REVIEWS ARE FETCHED HERE AND NOT WITH EVERYTHING ELSE, because it is the
-- decision this whole file exists to serve. Google prices a Places request at
-- the most expensive field in its mask, and `reviews` is an Enterprise +
-- Atmosphere field. Adding it to the Place Details mask the rest of the app uses
-- would lift EVERY save and EVERY nightly refresh into the top band — for a book
-- of a thousand leads, of which perhaps forty are ever rung. So reviews are
-- their own call, made once, seconds before the phone is picked up, and billed
-- through api_usage like everything else. The arithmetic stays the operator's
-- own: refreshing the book costs what refreshing the book costs, and reviews
-- cost one request each time he decides to phone somebody.
--
-- Both tables are on the TRANSIENT side of the split, treated exactly as
-- `search_results` is: thirty days, deleted by a scheduled job, gone whether or
-- not the app is awake. This is Google content held under Google's terms.
--
-- ON THE PEOPLE WHO WROTE THEM. Google returns an author's display name, photo
-- and profile link with every review. None of it is stored, for the same reason
-- the Impressum check does not extract the natural person it is legally certain
-- to find: the operator needs to know that three reviews mention the parking,
-- not who mentioned it. There is no column here for a name, so there is no way
-- for one to arrive by accident — and once a model sits behind the assistant
-- boundary, that is the difference between sending it a business's reputation
-- and sending it a stranger's identity.

-- ---------------------------------------------------------------------------
-- place_review_fetches — that we asked, and when.
--
-- A second table earns its place by answering one question the review rows
-- cannot: "does this business have no reviews, or has nobody looked?" Those two
-- states look identical in an empty result set and they cost differently — the
-- first should never be asked about again inside the retention window, the
-- second must be. Without this table every prepare for a business with no
-- reviews would spend a fresh Enterprise + Atmosphere request to rediscover that
-- there is nothing there.
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
-- which is not what the owner sees when he looks at his own listing, and he is
-- the person on the other end of the call.
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
  -- is what the operator would say out loud, and because it survives the publish
  -- time being absent.
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
-- The fifth of these jobs, beside the search results, the geocodes, the deleted
-- leads and the call transcripts. Same argument every time: if the app goes dark
-- for a month, the content still expires.
--
-- Parents first, so the cascade does the bulk of the work and the second delete
-- only ever catches a row whose expiry was written by hand. Deleting the rows
-- first and the parents second would leave, for the length of one statement, a
-- fetch row claiming three reviews with none behind it — which is the one state
-- the reader must never see, because it reads as "asked recently, found none".
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

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
  'Deletes Google-sourced review content past its retention window. Scheduled nightly via pg_cron, alongside the search-result, geocode and transcript jobs.';

-- 04:10 UTC daily, after the transcripts at 04:00 and the three jobs that were
-- already there. Serial rather than simultaneous because these are all deletes
-- on the same small database and there is nothing to gain by overlapping them.
select cron.schedule(
  'expire-place-reviews',
  '10 4 * * *',
  $$select public.expire_place_reviews()$$
);

-- ---------------------------------------------------------------------------
-- Lockdown. Both tables are new, so the blanket revokes in
-- 20260730180300_lockdown.sql ran before they existed. The default privileges
-- set there stop anon/authenticated inheriting anything; these lines are the
-- belt to that pair of braces, and they are what the first migration promised
-- for every table added afterwards.
-- ---------------------------------------------------------------------------
alter table public.place_review_fetches enable row level security;
alter table public.place_reviews        enable row level security;

revoke all on public.place_review_fetches from anon, authenticated;
revoke all on public.place_reviews        from anon, authenticated;
