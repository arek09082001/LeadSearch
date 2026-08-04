-- Lead Engine — the daily website-check allowance, raised to a working number.
--
-- 20260804120000 introduced `app_settings.mcp_site_check_daily_limit` at 50 and
-- argued the number as "roughly one worked market a day". That estimate was
-- wrong, and it was wrong in the direction that makes the feature look broken.
--
-- THE ARITHMETIC THAT SETTLES IT. One `search_places` call over 20 results
-- rejects most of them for free, and what survives the free filters is a
-- business with a website, five ratings and 3.5 stars — in a German trade market
-- that is most of the twenty. Sixteen checks off a single call is ordinary, not a
-- worst case. Fifty is therefore three calls, and the fourth one of an afternoon
-- comes back with `quotaReached` against businesses nobody looked at. The
-- operator reads an empty `saved` list and cannot tell a worked-out market from
-- an allowance he ran into an hour ago.
--
-- 300 is twenty such calls, which is a day's work rather than a morning's.
--
-- WHY THIS IS STILL A DATABASE VALUE AND NOT AN ENVIRONMENT VARIABLE. The
-- obvious alternative — SITE_CHECK_DAILY_LIMIT in Vercel — was considered and
-- rejected for the reason `monthly_ceiling_usd` and `assistant_ceiling_usd` are
-- not environment variables either: every other bound in this product is a row
-- the operator can read and change beside the running total it governs, and a
-- fourth one that could only be changed by redeploying would be the odd one out
-- in both directions. It would also be a second source of truth for a number
-- `readSiteCheckAllowance` already reads from here, and the day the two
-- disagreed would be the day the ledger stopped meaning anything.
--
-- WHAT THIS IS NOT. It does not bound Google, and nothing here goes near the
-- Places counter. Site checks cost no money at all — they are unattended HTTP
-- requests to small businesses' servers made in the operator's name, and that is
-- a question of manners rather than of billing. Money is bounded by
-- `monthly_ceiling_usd`, in `api_usage`, untouched by this file.

-- The default, for any database built from schema.sql after today.
alter table public.app_settings
  alter column mcp_site_check_daily_limit set default 300;

-- ---------------------------------------------------------------------------
-- And the row that already exists, which the default cannot reach.
--
-- `app_settings` is a singleton — one row, `id` fixed true — inserted before
-- this migration ran, so it is still carrying 50. A default alone would raise
-- the limit on every fresh install and on no deployment that is actually in use,
-- which is the exact opposite of what this file is for.
--
-- Guarded on `= 50` rather than applied unconditionally. If somebody has already
-- chosen a number here, that number is a decision and this migration is not
-- entitled to overrule it — 50 is the only value that can be assumed to be the
-- old default rather than an answer.
-- ---------------------------------------------------------------------------
update public.app_settings
   set mcp_site_check_daily_limit = 300
 where mcp_site_check_daily_limit = 50;

comment on column public.app_settings.mcp_site_check_daily_limit is
  'How many websites search_places may fetch per UTC day. Not a price — a manners bound on unattended requests to other people''s servers. Enforced by summing mcp_call_log.site_checks. Deliberately a row rather than an environment variable, so it can be changed beside the ledger it governs instead of by a deploy.';
