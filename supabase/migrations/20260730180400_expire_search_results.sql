-- Lead Engine — the scheduled job that enforces the split.
--
-- Expiry runs in the database rather than in a Vercel cron so that the
-- compliance promise does not depend on the app being deployed, awake, or
-- reachable. If Lead Engine goes dark for a month, Google data still expires.
--
-- `searches` is deliberately NOT touched: it is the operator's own query
-- history and holds no Google content. Deleting results leaves the history row
-- intact, with its result_count preserved as a record of what was found.

create extension if not exists pg_cron;

create or replace function public.expire_search_results()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.search_results where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.expire_search_results() from public, anon, authenticated;

comment on function public.expire_search_results() is
  'Deletes Google-sourced search results past their retention window. Scheduled nightly via pg_cron.';

-- 03:15 UTC daily.
select cron.schedule(
  'expire-search-results',
  '15 3 * * *',
  $$select public.expire_search_results()$$
);
