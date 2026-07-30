-- Lead Engine — what the scorer needs from the schema, which is very little.
--
-- The table it writes to already exists: `lead_scores` was drawn with the score,
-- the config version and a jsonb breakdown from the start, and the trigger that
-- denormalises the newest row onto `leads.current_score` has been in place since
-- the same migration. So this adds no storage. It relaxes one constraint that
-- turned out to be wrong, and adds two work-list views — one per pass — for the
-- one question the application cannot ask PostgREST in a single round trip.

-- ---------------------------------------------------------------------------
-- A score may be absent, and absent is not zero.
--
-- Some businesses are deliberately taken out of the ranking rather than ranked
-- badly: permanently closed, or not one review on Google. They are not weak
-- leads, they are not leads, and the operator asked for them to score null.
--
-- NOT NULL made that impossible to express. The only other way to keep them
-- from ranking would have been to write no score row at all — which loses the
-- reason, and worse, leaves a lead that WAS scored before it closed sitting at
-- its old 90 for ever, first in the list, permanently closed.
--
-- So the row is still written, `score` is null, and `factors` carries the rule
-- that withheld it. The denormalisation trigger already copies the newest row's
-- score verbatim, so a null lands on `leads.current_score` and the lead sinks —
-- and every surface already distinguishes a null score from a zero one, because
-- "not scored yet" needed that distinction first.
--
-- The range check is untouched: a CHECK passes on null, so it still constrains
-- every score that exists.
-- ---------------------------------------------------------------------------
alter table public.lead_scores alter column score drop not null;

comment on column public.lead_scores.score is
  '0-100, or null when the business is deliberately excluded from ranking. Never zero for absence — zero means audited and nothing found.';
comment on column public.lead_scores.factors is
  'The full breakdown that produced the score: every fault with its points, the business-signal tier, and the exclusion rule when there is one. Written so an old score stays explainable under a config that has since changed.';

-- ---------------------------------------------------------------------------
-- lead_score_queue — which leads need scoring, as one predicate.
--
-- Scoring is free once the findings are stored, but knowing WHICH leads to
-- score is a comparison between two tables that PostgREST cannot express: the
-- newest score's audit against the lead's newest audit. Doing it in the client
-- would mean reading every lead and every score on every pass.
--
-- Three rules are built into the WHERE clause, and each is load-bearing:
--
--   1. Nothing is scored while PageSpeed is still running. Those findings
--      append to the SAME audit a stage later, so a score computed before they
--      land would be computed on half a diagnosis — and then look settled.
--   2. A lead is stale when its newest score was computed against a different
--      audit than its newest one. That covers the first score (no score row at
--      all) and every re-audit, without a timestamp comparison that daylight
--      saving or a clock skew could get wrong.
--
--   3. An audit with no findings at all is not scored. That is exactly and only
--      the case where the CHECKER broke: every path through `judgeMeasurement`
--      that reached the business emits at least one row, including the passing
--      `no_website` row, and the error path deliberately emits nothing because
--      the failure says something about the checker and nothing about the
--      business. Scoring that as 0 would file "we could not look" under "we
--      looked and it was fine", and bury a real lead at the bottom of the list.
--      No score at all is the honest reading, and the row stays in this queue
--      so a re-audit picks it straight back up.
--
-- Config changes are deliberately NOT a staleness condition here. A view cannot
-- know which version the running build holds, and the operator already has the
-- right tool for it: changing a weight means rescoring the book, which is a
-- separate unconditional pass that costs nothing.
--
-- The business signals ride along because the scorer needs them and fetching
-- them separately would be a second round trip per pass for three columns.
-- ---------------------------------------------------------------------------
create view public.lead_score_queue
with (security_invoker = on) as
select
  l.id              as lead_id,
  l.latest_audit_id as audit_id,
  l.rating,
  l.user_rating_count,
  l.business_status
from public.leads l
  join public.lead_audits a on a.id = l.latest_audit_id
  left join public.lead_scores s on s.id = l.current_score_id
where l.deleted_at is null
  and a.psi_state not in ('pending', 'running')
  and exists (select 1 from public.lead_audit_findings f where f.audit_id = a.id)
  and s.audit_id is distinct from l.latest_audit_id;

comment on view public.lead_score_queue is
  'Leads whose newest audit has settled and has no score computed against it. The scorer''s work list; empty is the steady state.';

revoke all on public.lead_score_queue from anon, authenticated;

-- ---------------------------------------------------------------------------
-- lead_scoring_inputs — the same signals, for every live lead.
--
-- What a bulk rescore reads. It differs from the queue in exactly one way: it
-- does not care whether a score already exists, because after a weight changes
-- every score is wrong and the whole book is the work list.
--
-- It is a view rather than a filter on `leads` so that both passes agree on
-- what "a lead that can be scored" means — settled audit, not deleted. Two
-- definitions would eventually drift, and the day they did, the rescore would
-- quietly skip rows the incremental pass had been scoring all along.
--
-- The score already on the lead comes along so the pass can tell a tuning edit
-- that changed this lead from one that did not. Re-ranking is expected to be
-- run repeatedly over an afternoon of tuning, and appending five hundred
-- identical rows each time would bury the history that `lead_scores` is for.
-- ---------------------------------------------------------------------------
create view public.lead_scoring_inputs
with (security_invoker = on) as
select
  l.id              as lead_id,
  l.latest_audit_id as audit_id,
  l.rating,
  l.user_rating_count,
  l.business_status,
  l.current_score,
  s.config_version  as current_config_version
from public.leads l
  join public.lead_audits a on a.id = l.latest_audit_id
  left join public.lead_scores s on s.id = l.current_score_id
where l.deleted_at is null
  and a.psi_state not in ('pending', 'running')
  -- Same rule as the queue, and for the same reason: an audit that produced no
  -- judgements is the checker having broken, not a clean website.
  and exists (select 1 from public.lead_audit_findings f where f.audit_id = a.id);

comment on view public.lead_scoring_inputs is
  'Every live lead with a settled audit, plus the business signals scoring needs. The bulk rescore''s work list.';

revoke all on public.lead_scoring_inputs from anon, authenticated;
