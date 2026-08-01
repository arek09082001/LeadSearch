-- Lead Engine — the one part of a summary the original table could not hold.
--
-- `call_summaries` was written with three things a provider hands back: the
-- prose, a status to move to, and a sentence saying what to do next. A fourth
-- turns up the moment the summary stops being a document and becomes something
-- the operator takes: when a day was agreed on the phone, "call back Thursday"
-- has to arrive as a date he can accept with one press, not as a sentence he
-- reads and then re-types into the follow-up field.
--
-- A DATE, NOT AN OFFSET, and that is the whole content of this file.
--
-- The provider works in offsets — `suggestedFollowUpDays`, because a fixture is
-- data and a model has no clock, and both would otherwise be inventing "today".
-- The offset is resolved against `calls.ended_at` on the way in here, once, and
-- what lands in the column is a day on a calendar. Storing the offset would mean
-- a summary opened a week later suggested a callback a week later still — the
-- suggestion would quietly follow the reader around instead of describing what
-- was agreed on the phone.
--
-- `date` rather than `timestamptz` to match `leads.follow_up_at`, which is the
-- column this one is copied into and which is a plain day with no time in it.
-- See lib/leads/dates.ts for why that distinction is load-bearing here.
--
-- Nullable, and the null is a real answer: nothing was agreed. Most calls end
-- that way, and a default of "a week from now" would fill the follow-up queue
-- with dates nobody chose.

alter table public.call_summaries
  add column suggested_follow_up_at date;

comment on column public.call_summaries.suggested_follow_up_at is
  'A suggestion, never applied — like suggested_status. Resolved from the provider''s day offset against calls.ended_at at write time, so it stays the day that was agreed rather than one measured from whenever it is read. Null means nothing was agreed.';
