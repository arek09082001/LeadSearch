-- Lead Engine — the mobile screenshot Lighthouse already took.
--
-- WHY THIS COSTS NOTHING
--
-- lib/enrichment/pagespeed.ts already asks PageSpeed Insights to profile the
-- site with strategy=mobile. Lighthouse renders the page on a simulated phone to
-- do that, and hands back the last frame it rendered in the same response, under
-- audits['final-screenshot'].details.data as a base64 JPEG data URI. It is in
-- the performance category (weight 0, group 'hidden'), so the existing
-- `category=performance` request already pays for it and already receives it.
--
-- So this migration adds somewhere to keep a picture we are already being given.
-- No headless browser, no screenshot service, no second API, no cent.
--
-- WHY NOT IN lead_audits.raw
--
-- A mobile JPEG at 412x823 is 30-120 KB, and base64 adds a third on top. Putting
-- that in a jsonb column would put it in every `select raw` — and the audit row
-- is read on the library, the lead page and every rescore. The bytes go to
-- Storage; the row keeps a path.

-- ---------------------------------------------------------------------------
-- The column.
--
-- A MEASUREMENT, in the sense the enrichment schema draws: it records what was
-- observed, not whether it is bad. Nothing in lead_audit_findings judges it and
-- nothing in scoring reads it — which is what keeps a rescore free of network
-- calls, because a screenshot is the one thing on an audit that cannot be
-- recomputed from the row.
--
-- Null is the ordinary case, not an error: it means this audit never reached the
-- PageSpeed stage (no website, a social profile, an unreachable site), or
-- PageSpeed refused, or Lighthouse ran without producing a frame.
-- ---------------------------------------------------------------------------
alter table public.lead_audits
  add column screenshot_path text;

comment on column public.lead_audits.screenshot_path is
  'Object key in the private lead-screenshots bucket for the mobile screenshot Lighthouse returned with this audit''s PageSpeed run. Null when there is no screenshot — which includes every audit that never reached the PageSpeed stage. Never a URL: the bucket is private and links are signed per request.';

-- ---------------------------------------------------------------------------
-- The bucket.
--
-- PRIVATE, and that is the load-bearing word. A public bucket would make every
-- screenshot readable by object key to anyone who guessed a uuid, which for this
-- product means publishing photographs of the websites of businesses that have
-- not been contacted yet. Reads go through app/api/audits/[id]/screenshot, which
-- checks the session first and then mints a short-lived signed URL.
--
-- Storage's own authorization needs no help from us and gets none. storage.objects
-- has RLS enabled by Supabase with no policy covering this bucket, so `anon` and
-- `authenticated` match nothing; `service_role` — what SUPABASE_SECRET_KEY
-- resolves to, and only the server holds it — bypasses RLS. That is the same
-- deny-by-default shape the public schema is locked down with in
-- 20260730180300_lockdown.sql, arrived at without writing a policy.
--
-- The limits are belt and braces around a number we do not control: Lighthouse
-- decides how big the frame is, and the application already refuses anything
-- absurd before it uploads. This makes the refusal the storage layer's too.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-screenshots',
  'lead-screenshots',
  false,
  3145728,                      -- 3 MiB. A mobile JPEG is ~100 KB; this is a ceiling, not a target.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Finding the objects a lead still owns.
--
-- The application keeps ONE screenshot per lead — the newest audit's — and
-- deletes the older ones as each new screenshot lands, so Storage grows with the
-- size of the book rather than with the number of times it has been audited.
-- That matters at a monthly ceiling of zero: the free tier is 1 GB, and a
-- re-audit every month without pruning would spend it on pictures of the same
-- websites.
--
-- This index is what makes that prune a lookup rather than a scan of every audit
-- the lead has ever had.
-- ---------------------------------------------------------------------------
create index lead_audits_screenshot_idx on public.lead_audits (lead_id)
  where screenshot_path is not null;
