-- Lead Engine — the phone call, and what the assistant said during it.
--
-- Five tables, one denormalised pointer, and one scheduled deletion. The
-- deletion is the part that matters and everything else is arranged around it.
--
-- THE SPLIT THIS FILE DRAWS, which is the same split the schema has drawn
-- everywhere else and has never had to draw over somebody else's voice:
--
--   TRANSIENT  call_transcript_segments — the words a stranger said. Deleted on
--              a fourteen-day clock by a job in the database, exactly as
--              `search_results` is. Not archived, not anonymised. Deleted.
--   PERMANENT  calls, call_briefings, call_tips, call_summaries — the operator's
--              own work: that he rang, what he was handed to say, what the
--              assistant suggested, and what he concluded. None of it is
--              anybody else's speech.
--
-- A transcript of an unconsenting third party is the most sensitive thing this
-- database will ever hold, and it is the one kind of row here whose subject
-- never agreed to be in it. So the summary survives and the wording does not —
-- which is also, separately, the more useful arrangement: six months later the
-- paragraph is what gets read and the transcript would not be.
--
-- `consent_noted` is a RECORD, not a gate. Postgres cannot tell whether the
-- operator actually said the words, so the column does not pretend to enforce
-- anything; the app is expected to refuse to transcribe without it, and the
-- assistant's `consent_not_noted` tip exists to catch the case where it did not.

-- ---------------------------------------------------------------------------
-- calls — one row per attempt, whether or not anybody picked up.
--
-- Attempts, not conversations: a lead rung four times and reached once is four
-- rows, because "we have tried this business four times" is the fact the
-- outreach queue needs and it is unrecoverable from a table that only records
-- the successes.
--
-- `outcome` is TEXT and deliberately not an enum, by the rule the enum
-- migration states: an enum only where the vocabulary is DECIDED. How a call
-- ended is the operator's own shorthand and it will grow with his habits — the
-- names worth having today are listed in `lib/assistant/vocabulary.ts`, where
-- adding one costs nothing. `status_before` and `status_after` ARE enums,
-- because they name the lead lifecycle, which is decided and already an enum.
-- ---------------------------------------------------------------------------
create table public.calls (
  id             uuid        primary key default gen_random_uuid(),
  lead_id        uuid        not null references public.leads (id) on delete cascade,

  started_at     timestamptz not null default now(),
  -- Null while the call is in progress. That is a real state with a surface of
  -- its own, not a missing value: it is the row the assistant is writing tips
  -- against right now.
  ended_at       timestamptz,

  consent_noted  boolean     not null default false,

  outcome        text,

  -- Where the lead stood before and after. Denormalised from the lead on
  -- purpose: `leads.status` is a moving target and a call has to stay readable
  -- as the thing that moved it, months after it moved again.
  status_before  public.lead_status,
  status_after   public.lead_status,

  created_at     timestamptz not null default now(),

  constraint calls_ended_after_started
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.calls is
  'One outreach call attempt, answered or not. The permanent record; the transcript that may hang off it is not.';
comment on column public.calls.ended_at is
  'Null means the call is in progress. A real state, not a missing value.';
comment on column public.calls.consent_noted is
  'Did the operator state that the call is being transcribed. A record of what he did, not a gate — the app must refuse to transcribe without it.';
comment on column public.calls.outcome is
  'How the call ended, in the operator''s own shorthand. Free text; the names worth having are in lib/assistant/vocabulary.ts.';

create index calls_lead_id_started_at_idx on public.calls (lead_id, started_at desc);
create index calls_started_at_idx         on public.calls (started_at desc);
-- The call being had right now, and any that were never closed off.
create index calls_in_progress_idx on public.calls (started_at desc)
  where ended_at is null;

-- ---------------------------------------------------------------------------
-- call_briefings — what the operator was handed before the line connected.
--
-- `content` is jsonb rather than columns for the reason `lead_scores.factors`
-- is: the shape is the assistant's output and it will change, and a briefing
-- written under an older shape must stay readable rather than become a failed
-- migration. `provider` and `model` beside it are what make that possible — they
-- say which implementation wrote the shape.
--
-- Several rows per call are allowed. A briefing can be regenerated (the audit
-- landed late, the first one was thin), and keeping only the newest would erase
-- the fact that the operator opened the call on a different argument.
-- ---------------------------------------------------------------------------
create table public.call_briefings (
  id           uuid        primary key default gen_random_uuid(),
  call_id      uuid        not null references public.calls (id) on delete cascade,

  generated_at timestamptz not null default now(),
  -- The registry id: 'mock', 'anthropic'. Never null — an answer with no author
  -- is the one row that cannot be judged later.
  provider     text        not null,
  -- Null when no model was involved, which is the mock's honest answer. Not a
  -- placeholder: 'mock' in provider with a model name beside it reads, a year
  -- later, as a real generation that was mislabelled.
  model        text,

  content      jsonb       not null,

  created_at   timestamptz not null default now()
);

comment on table public.call_briefings is
  'What the assistant handed over before a call, with who wrote it. Content is jsonb so an old briefing stays readable under a shape that has since changed.';

create index call_briefings_call_id_generated_at_idx
  on public.call_briefings (call_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- call_transcript_segments — the words. On a clock.
--
-- Treated exactly as `search_results` is treated, and for a stronger reason.
-- Google data expires because a licence says it must; this expires because the
-- person who said it never agreed to be recorded by a sales tool, and a
-- retention window is the only promise about that which does not depend on
-- anybody remembering to keep it.
--
-- FOURTEEN DAYS, and the number is short on purpose. The window only has to be
-- long enough to write the summary and check it — everything past that is a
-- recording being kept because deleting it was never scheduled. `search_results`
-- gets thirty because it holds business listings; this holds a voice.
--
-- `at_ms` is milliseconds from `calls.started_at`, not a wall clock. A call is a
-- timeline of its own, and the only question ever asked of a segment is where in
-- that timeline it sits — which survives a clock skew, a timezone change, and
-- being read a year later.
--
-- Deliberately NO index on `text` and no full-text column. Searching across the
-- recorded speech of every business ever rung is not a feature this tool is
-- going to grow, and the cheapest way to be sure is to never build the index
-- that would make it convenient.
-- ---------------------------------------------------------------------------
create table public.call_transcript_segments (
  id         bigint generated always as identity primary key,
  call_id    uuid        not null references public.calls (id) on delete cascade,

  at_ms      integer     not null,
  speaker    text        not null,
  text       text        not null,

  expires_at timestamptz not null default (now() + interval '14 days'),

  constraint call_transcript_segments_at_ms_non_negative
    check (at_ms >= 0),
  -- Closed set, and small enough to state here rather than spend an enum on.
  -- 'unknown' is a real answer from a recogniser that could not tell the two
  -- voices apart, and it must not be silently filed as the business.
  constraint call_transcript_segments_speaker_known
    check (speaker in ('operator', 'business', 'unknown'))
);

comment on table public.call_transcript_segments is
  'Verbatim call speech, deleted after fourteen days by expire_call_transcripts(). The summary survives; the wording does not.';
comment on column public.call_transcript_segments.at_ms is
  'Milliseconds from calls.started_at. A call is its own timeline; a wall clock would add nothing and could disagree with itself.';
comment on column public.call_transcript_segments.expires_at is
  'Enforced by the scheduled job, not by Postgres. Default window: 14 days, long enough to write and check a summary and no longer.';

create index call_transcript_segments_call_id_at_ms_idx
  on public.call_transcript_segments (call_id, at_ms);
create index call_transcript_segments_expires_at_idx
  on public.call_transcript_segments (expires_at);

-- ---------------------------------------------------------------------------
-- call_tips — what the assistant said, and whether it was any use.
--
-- Kept, while the transcript beside it is not, and the distinction is exact: a
-- tip is something THIS TOOL produced. It is the assistant's own behaviour on
-- the record, which is the only way "is the assistant helping" ever becomes an
-- answerable question rather than an impression.
--
-- That only holds while a tip body does not quote the call. It is a constraint
-- on the provider, not on the schema — nothing here can check it — and it is
-- written down because a model asked for a helpful one-liner will happily hand
-- back the customer's own sentence, and that sentence would then outlive the
-- fourteen days by sitting in a table that never expires.
--
-- `shown` and `acted_on` are written by the app, never by the provider. The
-- first is honest bookkeeping — a tip generated at the moment the call ended was
-- never read by anyone — and the second is the operator's own verdict.
-- ---------------------------------------------------------------------------
create table public.call_tips (
  id       bigint generated always as identity primary key,
  call_id  uuid    not null references public.calls (id) on delete cascade,

  at_ms    integer not null,
  -- From the closed trigger vocabulary in lib/assistant/vocabulary.ts. Text
  -- rather than an enum for the reason the audit's finding codes are text: the
  -- list grows as the assistant learns to recognise more, and a migration per
  -- trigger would be the schema charging rent on that.
  trigger  text    not null,
  body     text    not null,

  shown    boolean not null default false,
  acted_on boolean not null default false,

  constraint call_tips_at_ms_non_negative check (at_ms >= 0)
);

comment on table public.call_tips is
  'Every tip the assistant offered during a call, with whether it reached the screen and whether it was used. The assistant''s own behaviour, on the record.';
comment on column public.call_tips.body is
  'Must not quote the call. A tip outlives the transcript, and a quoted sentence in here would outlive the retention window with it.';
comment on column public.call_tips.shown is
  'Did it reach the screen. A tip generated as the call ended was never read, and counting it as help would flatter the assistant.';

create index call_tips_call_id_at_ms_idx on public.call_tips (call_id, at_ms);

-- ---------------------------------------------------------------------------
-- call_summaries — what is left when the words are gone.
--
-- The one row that has to be readable cold. After fourteen days this paragraph
-- is the entire record of what was said on the phone, which is what makes
-- `body` text rather than jsonb: it is prose, meant to be read by a person, and
-- a structure around it would only invite a surface that renders four fields
-- nobody asked for.
--
-- `suggested_status` is a SUGGESTION and the schema keeps it that way: it sits
-- here, beside `accepted`, and nothing in this file writes it onto the lead. A
-- status that moved itself because a model heard "maybe next quarter" would be
-- a book that had quietly stopped describing what the operator believes.
-- ---------------------------------------------------------------------------
create table public.call_summaries (
  id                    uuid        primary key default gen_random_uuid(),
  call_id               uuid        not null references public.calls (id) on delete cascade,

  provider              text        not null,
  model                 text,

  body                  text        not null,
  suggested_status      public.lead_status,
  suggested_next_action text,

  -- Three states, and the third is the useful one: null means the operator has
  -- not looked yet. A default of false would file every unreviewed summary as
  -- rejected and quietly make the assistant look worse the busier he was.
  accepted              boolean,

  created_at            timestamptz not null default now(),

  constraint call_summaries_body_not_blank check (length(btrim(body)) > 0)
);

comment on table public.call_summaries is
  'What survives a call. After the transcript expires this is the only record of what was said.';
comment on column public.call_summaries.suggested_status is
  'A suggestion, never applied. Moving the lead is the operator''s act, recorded in accepted.';
comment on column public.call_summaries.accepted is
  'Null until the operator has looked. False is a rejection, which is a different fact from an unreviewed summary.';

create index call_summaries_call_id_idx on public.call_summaries (call_id, created_at desc);

-- ---------------------------------------------------------------------------
-- leads.latest_call_id — the newest attempt, denormalised by trigger.
--
-- Maintained exactly as `latest_audit_id` and `latest_refresh_id` are, and never
-- written by the app. Newest by `started_at`, INCLUDING a call still in progress
-- — the lead being rung right now is the lead most recently called, and a
-- pointer that only tracked finished calls would go stale for the one minute the
-- surface most needs it.
--
-- Deliberately NOT accompanied by a `last_called_at` column. `latest_audit_id`
-- has one because the library sorts and filters on audit age across thousands of
-- rows; nothing sorts on call age, and a second denormalised column exists only
-- to disagree with the first one day.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column latest_call_id uuid references public.calls (id) on delete set null;

comment on column public.leads.latest_call_id is
  'Newest calls row for this lead, in progress or finished. Denormalised by trigger; do not write directly.';

create or replace function public.refresh_lead_call_cache()
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

  -- Recomputed from scratch rather than trusting NEW, so insert, update and
  -- delete all converge on the truth. Same shape as refresh_lead_audit_cache().
  update public.leads l
     set latest_call_id = c.id
    from (
      select id
        from public.calls
       where lead_id = v_lead_id
       order by started_at desc, id desc
       limit 1
    ) c
   where l.id = v_lead_id;

  if not found then
    update public.leads set latest_call_id = null where id = v_lead_id;
  end if;

  return null;
end;
$$;

create trigger calls_refresh_cache
  after insert or update or delete on public.calls
  for each row execute function public.refresh_lead_call_cache();

revoke all on function public.refresh_lead_call_cache() from public, anon, authenticated;

-- A call is deliberately NOT written into lead_activities by trigger. The
-- outreach log already has a 'call' type and the app is the half that knows
-- whether a given attempt is worth a line in the timeline — a row per unanswered
-- ring would bury the history the log exists for. Stated here so the absence
-- reads as a decision rather than as an oversight.

-- ---------------------------------------------------------------------------
-- The deletion. The part of this file that is a promise.
--
-- Scheduled in the database rather than in a Vercel cron for the reason
-- expire_search_results() is: if Lead Engine goes dark for a month, the
-- recordings still expire. That argument is stronger here — the app being down
-- is not a reason for somebody else's voice to sit in a table indefinitely.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function public.expire_call_transcripts()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.call_transcript_segments where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.expire_call_transcripts() from public, anon, authenticated;

comment on function public.expire_call_transcripts() is
  'Deletes call speech past its retention window. Scheduled nightly via pg_cron. The summary is unaffected.';

-- 04:00 UTC daily, after the three jobs that were already there.
select cron.schedule(
  'expire-call-transcripts',
  '0 4 * * *',
  $$select public.expire_call_transcripts()$$
);

-- ---------------------------------------------------------------------------
-- Lockdown, on the same three layers as everything else.
--
-- Layers 2 and 3 — the blanket revoke and the schema USAGE revoke — already
-- cover these tables: `alter default privileges` was set in the lockdown
-- migration, so anon and authenticated were never granted anything on them.
-- RLS is per-table and has to be said, and the explicit revoke is restated so
-- this file is correct on its own rather than dependent on a migration three
-- files back still being in force.
-- ---------------------------------------------------------------------------
alter table public.calls                   enable row level security;
alter table public.call_briefings          enable row level security;
alter table public.call_transcript_segments enable row level security;
alter table public.call_tips               enable row level security;
alter table public.call_summaries          enable row level security;

-- Intentionally no policies. See the lockdown migration.
revoke all on public.calls                    from anon, authenticated;
revoke all on public.call_briefings           from anon, authenticated;
revoke all on public.call_transcript_segments from anon, authenticated;
revoke all on public.call_tips                from anon, authenticated;
revoke all on public.call_summaries           from anon, authenticated;
