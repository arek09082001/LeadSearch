-- Lead Engine — what a full diagnosis needs.
--
-- The audit up to now measured six things at the front door. This widens it to
-- everything the operator asked to be able to say on a cold call, and adds the
-- judgement half that was deliberately left empty when the schema was drawn:
-- `lead_audit_findings` finally gets written to.
--
-- The rule from the original migration still holds and is the reason this is
-- mostly new COLUMNS plus one array:
--
--   COLUMNS on lead_audits hold MEASUREMENTS  — what was observed.
--   FINDINGS hold JUDGEMENTS                  — whether it is a problem, how bad.
--
-- A measurement earns a column when it carries a value worth showing as proof
-- ("PageSpeed 23", "certificate expired in 2021", "WordPress 4.9") or when it
-- is the headline fact about a business. Everything that is merely a verdict
-- stays a finding, where adding a check still costs no migration.

-- ---------------------------------------------------------------------------
-- PageSpeed runs as its own stage, so it gets its own job state.
--
-- An enum, by the same test the enrichment lifecycle passed: this vocabulary is
-- closed and mine. It describes a job, not a verdict, so nothing here pre-empts
-- the criteria.
--
-- 'skipped' rather than null is the default because it is the truth for every
-- audit written before this migration and for every lead with no site to profile.
-- ---------------------------------------------------------------------------
create type public.psi_state as enum (
  'pending',  -- the fast pass finished; PageSpeed has not run yet
  'running',  -- an invocation has claimed it
  'ok',       -- scores below are real
  'failed',   -- PageSpeed was asked and could not answer; see psi_error
  'skipped'   -- never asked: no website, not a real site, or it did not answer
);

-- ---------------------------------------------------------------------------
-- lead_audits — the widened measurement set.
-- ---------------------------------------------------------------------------
alter table public.lead_audits
  -- Availability. Two different businesses hide behind one "unreachable":
  -- a domain that no longer resolves (they let it lapse) and a server that
  -- refused (it is misconfigured). The first is the better sales call, so it
  -- is worth being able to tell them apart.
  add column dns_resolves     boolean,

  -- Trust. Separate from is_https, which only says the final URL had an https
  -- scheme. A site can serve https with a certificate that expired two years
  -- ago, and that is a stronger argument than not having one at all.
  add column tls_valid        boolean,
  add column tls_expires_at   timestamptz,

  -- Markup, measured. has_meta_description already lived here; these three are
  -- the same kind of one-bit observation and belong beside it.
  add column has_title        boolean,
  add column has_favicon      boolean,
  add column is_table_layout  boolean,

  -- The version string as found, never as judged. '4.9' is the evidence; that
  -- 4.9 is ancient is a finding.
  add column platform_version text,

  -- What the "website" actually is: a real site, or a Facebook page, or a
  -- Linktree. Free text for the same reason platform is — the set grows with
  -- the checker.
  add column presence_kind    text,

  -- PageSpeed Insights, lab data, mobile strategy.
  add column psi_state        public.psi_state not null default 'skipped',
  add column psi_performance  smallint,
  add column psi_lcp_ms       integer,
  add column psi_cls          numeric(5, 3),
  add column psi_error        text,
  -- When the stage last acted on this row: set on claim, overwritten on
  -- completion. One column rather than two, because the only question ever
  -- asked of it is "has this been sitting in `running` too long".
  add column psi_checked_at   timestamptz,

  -- Denormalised from lead_audit_findings by trigger. See below.
  add column failed_codes     text[] not null default '{}',

  add constraint lead_audits_psi_performance_range
    check (psi_performance is null or (psi_performance between 0 and 100)),
  add constraint lead_audits_psi_lcp_non_negative
    check (psi_lcp_ms is null or psi_lcp_ms >= 0),
  add constraint lead_audits_psi_cls_non_negative
    check (psi_cls is null or psi_cls >= 0);

comment on column public.lead_audits.dns_resolves is
  'Did the hostname resolve at all. Separates a lapsed domain from a broken server; both read as unreachable otherwise.';
comment on column public.lead_audits.tls_valid is
  'Did the certificate verify. Null means https was never successfully negotiated, which is not the same as an invalid certificate.';
comment on column public.lead_audits.presence_kind is
  'What the stored website really is: site, facebook, instagram, linktree, google_business, directory. Free text, like platform.';
comment on column public.lead_audits.psi_state is
  'Lifecycle of the PageSpeed stage, not its verdict. It runs after the audit row exists, so a lead has a diagnosis before its scores arrive.';
comment on column public.lead_audits.failed_codes is
  'Codes of this audit''s failed findings, maintained by trigger. Do not write directly.';

-- The PageSpeed stage claims work with this, and reclaims abandoned work with
-- the same index — hence both live states, not just 'pending'.
create index lead_audits_psi_queue_idx on public.lead_audits (psi_state, audited_at)
  where psi_state in ('pending', 'running');

-- ---------------------------------------------------------------------------
-- failed_codes — findings, folded back onto the audit so the library can filter
-- on them with one predicate.
--
-- Without this, "no HTTPS *or* not mobile-friendly" would have to reach through
-- lead_audit_findings, and the leads_library view exists precisely so that no
-- filter has to. Folding the codes onto the audit keeps every audit filter an
-- ordinary predicate on one relation, which is the whole design of that view.
--
-- Append-only is what makes a statement-level INSERT trigger sufficient: a
-- re-audit writes a NEW audit row with new findings, and a finding is never
-- edited. Deletes are not handled on purpose — findings only disappear when
-- their audit is cascade-deleted, and updating a row that is being deleted in
-- the same statement would be a footgun for no benefit.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_audit_failed_codes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Recomputed from the full finding set rather than from the inserted rows,
  -- so the PageSpeed stage appending its findings later converges on the truth
  -- instead of overwriting what the fast pass found.
  update public.lead_audits a
     set failed_codes = coalesce(agg.codes, '{}'::text[])
    from (
      select f.audit_id,
             array_agg(f.code order by f.severity, f.code)
               filter (where not f.passed) as codes
        from public.lead_audit_findings f
       where f.audit_id in (select distinct audit_id from new_findings)
       group by f.audit_id
    ) agg
   where a.id = agg.audit_id;

  return null;
end;
$$;

revoke all on function public.refresh_audit_failed_codes() from public, anon, authenticated;

create trigger lead_audit_findings_refresh_codes
  after insert on public.lead_audit_findings
  referencing new table as new_findings
  for each statement execute function public.refresh_audit_failed_codes();

-- ---------------------------------------------------------------------------
-- leads_library — rebuilt on the widened audit.
--
-- Replaced rather than altered: the new measurements belong beside the ones
-- they extend, not appended after note_count where nobody would look for them.
--
-- `audit_flags` is the one addition that is not a straight lift. It is the
-- audit filter set, as an array: the failed finding codes, or the single
-- synthetic flag 'never_audited' when there is no audit to have findings. That
-- synthesis is deliberate — it collapses every audit filter, including the
-- absence of an audit, into a single overlap test, so the query layer never has
-- to OR an array predicate against a null check.
--
-- The cost is that the CASE puts this out of reach of an index on
-- lead_audits.failed_codes. At the stated scale — thousands of leads, one
-- operator — that is a hash join over a few thousand rows, and the view already
-- carries two lateral aggregates per row for the same reason. No index is added
-- for it, because one that cannot be used is worse than none.
-- ---------------------------------------------------------------------------
drop view public.leads_library;

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
  a.dns_resolves,
  a.is_https,
  a.tls_valid,
  a.tls_expires_at,
  a.is_mobile_friendly,
  a.has_title,
  a.has_meta_description,
  a.has_favicon,
  a.is_table_layout,
  a.load_ms,
  a.copyright_year,
  a.platform,
  a.platform_version,
  a.presence_kind,
  a.psi_state,
  a.psi_performance,
  a.psi_lcp_ms,
  a.psi_cls,

  case
    when l.latest_audit_id is null then array['never_audited']::text[]
    else coalesce(a.failed_codes, '{}'::text[])
  end as audit_flags,

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
comment on column public.leads_library.audit_flags is
  'Every audit filter as one array: failed finding codes, or [never_audited] when the lead has no audit. Match with overlap.';

revoke all on public.leads_library from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-audit everything.
--
-- Every audit written before this migration predates findings entirely: it has
-- no diagnosis attached and every column added above is null on it. Left alone,
-- such a row renders as "nothing found" — which is the single thing it does not
-- mean, and exactly the kind of quiet wrongness that gets read aloud on a call.
--
-- So every live lead goes back in the queue. The pass drains it in slices the
-- next time the library is opened. The old audit rows are not touched: history
-- is the point of keeping them, and a re-audit has always been a new row rather
-- than an edit of an old one.
-- ---------------------------------------------------------------------------
update public.leads
   set enrichment_state      = 'queued',
       enrichment_queued_at  = now(),
       enrichment_started_at = null,
       enrichment_error      = null
 where deleted_at is null;
