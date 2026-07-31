-- Lead Engine — the library, as points on a map.
--
-- TWO FACTS, ONE FILE.
--
-- FIRST: `leads` has held lat and lng since the permanent side was built, and
-- the read model never passed them through. So the map is rebuilt on the SAME
-- view the list reads — `leads_library` — rather than on `leads` directly.
-- Anything else would be two answers to the question "which leads exist": one
-- the table gives and one the map gives, differing on the bin, on the deleted,
-- on whatever the next filter turns out to be. The day they disagree the
-- operator is looking at a pin he cannot find in his book.
--
-- Nothing else about the view moves. Two columns are added in the position the
-- table itself keeps them, between the address and the phone number.
--
-- SECOND: a bounding box is two range predicates, and a two-column btree on
-- (lat, lng) is what answers them.
--
-- NOT PostGIS. At the few thousand leads this product commits to, a geometry
-- column, a GiST index and an extension would be a larger thing than the
-- problem they solve — and the box a map asks for is axis-aligned by
-- construction, which is the one shape a btree on two columns already handles.
-- The day this book holds a million rows across a continent, that trade changes;
-- it does not change at the size the operator is actually working at.

-- ---------------------------------------------------------------------------
-- leads_library — rebuilt with the coordinates it was already sitting on.
--
-- Identical to the view built in 20260731090000_refresh_and_backoff.sql but for
-- l.lat and l.lng. Restated in full rather than patched because a view cannot be
-- altered to add a column in the middle: Postgres only appends. The order is
-- worth keeping — this definition is read as documentation of what a visible
-- lead is.
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
  l.lat,
  l.lng,
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
  l.refresh_error,

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

  coalesce(r.changes, '{}'::text[]) as change_flags,
  r.refreshed_at                    as changed_at,

  ll.list_ids,
  coalesce(n.note_count, 0) as note_count
from public.leads l
  left join public.lead_audits a on a.id = l.latest_audit_id
  left join public.lead_refreshes r on r.id = l.latest_refresh_id
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
  'Read model for the leads list AND the map: lead plus its newest audit measurements, its newest change set and its list membership, so every filter is a predicate on one relation and both surfaces agree on which leads exist.';
comment on column public.leads_library.audit_flags is
  'Every audit filter as one array: failed finding codes, or [never_audited] when the lead has no audit. Match with overlap.';
comment on column public.leads_library.change_flags is
  'The newest change set from the refresh pass, as codes. Empty when nothing has changed since the lead was saved.';
comment on column public.leads_library.lat is
  'Latitude from the Google snapshot, qualified by fetched_at like every other Google-sourced column. Null when Google gave no location — such a lead is in the book and off the map.';

revoke all on public.leads_library from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The index the bounding box reads.
--
-- Partial on `deleted_at is null` because that is the predicate every map read
-- carries — the live library is what gets drawn. The bin can be put on the map
-- too (it is the same filter set), and that read falls back to a scan; at this
-- size that costs nothing worth an index of its own.
--
-- Only the leading column gets a range scan out of a two-column btree; the
-- second is a filter applied to the rows that scan returns. A box is symmetric,
-- so either order works and neither is cleverer — lat leads because that is the
-- order the table declares the columns in and the order the predicate is
-- written in, and an index whose shape you can predict from the query is worth
-- more here than a benchmark on a book of this size.
-- ---------------------------------------------------------------------------
create index leads_lat_lng_idx on public.leads (lat, lng)
  where deleted_at is null;
