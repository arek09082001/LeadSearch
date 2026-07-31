-- Lead Engine — the filter bar's counts, computed where the rows are.
--
-- Every filter change in the library is a navigation, and every navigation
-- re-reads the facets: the cities the operator has saved from, the categories,
-- the lists and their live counts. That read has been a full scan shipped over
-- the wire — up to twenty thousand lead rows and twenty thousand list
-- memberships, fetched to Node, grouped in a loop, and thrown away to render
-- about thirty menu entries.
--
-- At the scale PRODUCT.md commits to — thousands of leads, revisited over
-- months — that is the wrong shape twice over. It is megabytes per click on the
-- surface the operator lives on, and it silently truncates: past the fetch
-- limit the counts quietly stop being true, with nothing saying so.
--
-- A GROUP BY belongs in the database. These views return one row per distinct
-- value, so the payload stops growing with the book.

-- ---------------------------------------------------------------------------
-- lead_facet_values — cities and categories present in the live library.
--
-- One view rather than two, with a `kind` discriminator, so the application
-- makes one round trip instead of two. They are read together, always, and
-- they have identical shape.
-- ---------------------------------------------------------------------------
create view public.lead_facet_values
with (security_invoker = on) as
select 'city' as kind, l.city as value, count(*) as count
  from public.leads l
 where l.deleted_at is null
   and l.city is not null
 group by l.city
union all
select 'category' as kind, l.primary_type as value, count(*) as count
  from public.leads l
 where l.deleted_at is null
   and l.primary_type is not null
 group by l.primary_type;

comment on view public.lead_facet_values is
  'Distinct cities and categories in the live library, with counts. One row per value, so the filter bar''s payload does not grow with the book.';

revoke all on public.lead_facet_values from anon, authenticated;

-- ---------------------------------------------------------------------------
-- lead_status_counts — the status facet.
--
-- Separate from the view above because its value is an enum rather than text,
-- and widening the union to a common type would mean casting the one column the
-- application wants to keep typed.
-- ---------------------------------------------------------------------------
create view public.lead_status_counts
with (security_invoker = on) as
select l.status, count(*) as count
  from public.leads l
 where l.deleted_at is null
 group by l.status;

comment on view public.lead_status_counts is
  'Live lead count per status, for the library''s status filter.';

revoke all on public.lead_status_counts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- lead_list_counts — every list, with how many LIVE leads are in it.
--
-- A left join, not an inner one: a list the operator made and has not filled
-- yet must still appear in the menu, at zero. And the count is over live leads
-- only — a list holding forty deleted leads must not advertise forty.
-- ---------------------------------------------------------------------------
create view public.lead_list_counts
with (security_invoker = on) as
select
  li.id,
  li.name,
  count(l.id) as count
from public.lists li
  left join public.lead_lists ll on ll.list_id = li.id
  left join public.leads l on l.id = ll.lead_id and l.deleted_at is null
group by li.id, li.name;

comment on view public.lead_list_counts is
  'Every list with its live membership count. Lists with no live leads appear at zero rather than vanishing from the filter.';

revoke all on public.lead_list_counts from anon, authenticated;

-- The count above is a join per list; this is the index it reads.
create index if not exists lead_lists_list_id_idx on public.lead_lists (list_id);
