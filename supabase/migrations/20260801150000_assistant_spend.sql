-- Lead Engine — what a model costs, and what it is allowed to cost.
--
-- The assistant stops being free the day `ASSISTANT_PROVIDER` says `anthropic`.
-- Two columns are what make that a thing the operator can see and stop.
--
-- WHY A SECOND CEILING RATHER THAN THE ONE THAT ALREADY EXISTS.
--
-- `monthly_ceiling_usd` defaults to 0 and that default is a statement about
-- GOOGLE: Places gives 1,000 free Text Search calls a month, the guard always
-- authorises a call that costs nothing, so a zero ceiling still buys around
-- twenty thousand businesses and only then stops dead. It is a cautious default
-- that still works.
--
-- A model has no free tier. Every token is billed from the first one, so the
-- same zero applied to the assistant would not be caution — it would mean
-- `ASSISTANT_PROVIDER=anthropic` is a variable that can be set and never works,
-- which is worse than no ceiling at all because it looks like a bug rather than
-- a policy. And raising the shared number to fix it would silently raise the
-- Google ceiling too, which is not what the operator asked for.
--
-- So: two ceilings, disjoint, each checked against its own half of the ledger.
-- Google spend can never be the reason a briefing is refused, and a month spent
-- briefing calls can never be the reason a search is. Both still land in
-- `api_usage`, so the running total on screen is the whole bill.
--
-- It defaults to 0 as well, and for the reason the other one does: the expensive
-- behaviour is the one that has to be asked for by name. An unconfigured
-- deployment with the variable set refuses every model call and says so.

alter table public.app_settings
  add column assistant_ceiling_usd numeric(10, 2) not null default 0.00;

alter table public.app_settings
  add constraint app_settings_assistant_ceiling_positive
  check (assistant_ceiling_usd >= 0);

comment on column public.app_settings.assistant_ceiling_usd is
  'Hard monthly stop on model spend, checked against the anthropic.* rows of api_usage only. Separate from monthly_ceiling_usd because Google has a free tier and a model does not; neither ceiling can be spent by the other.';

-- ---------------------------------------------------------------------------
-- api_usage.call_id — which conversation a token was spent on.
--
-- The sibling of `search_id`, and it exists for the same reason: "what did that
-- cost" is the question the ledger is read with, and a briefing, its tips and
-- its summary are one answer to it only if they can be counted together.
--
-- `on delete set null` rather than cascade, exactly as `search_id` is. Deleting
-- a call must not delete the record that money was spent — the invoice does not
-- forget, and a ledger that could be shortened by tidying up is not a ledger.
-- ---------------------------------------------------------------------------
alter table public.api_usage
  add column call_id uuid references public.calls (id) on delete set null;

comment on column public.api_usage.call_id is
  'The call this spend belongs to, when it belongs to one. Null for search and refresh traffic, which is most of the table.';

create index api_usage_call_id_idx on public.api_usage (call_id)
  where call_id is not null;
