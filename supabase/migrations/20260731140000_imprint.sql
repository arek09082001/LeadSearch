-- Lead Engine — what the site says about itself, and who to write to.
--
-- Everything the audit measures today answers one question: does this website
-- WORK. Does it resolve, does it encrypt, does it fit on a phone, how fast does
-- the server hand it over. Every one of those is a fine observation and every
-- one of them is arguable on a call — "it is fast enough", "nobody uses a phone
-- for this". The operator's own note on it is that he sells against opinions.
--
-- This migration adds the other kind of observation: what the site SAYS. A
-- German commercial website is expected to carry an Impressum and a privacy
-- policy, and it is expected not to hand a visitor's IP address to Google
-- before the page has rendered. Those are checkable, and a business owner does
-- not argue about whether the page exists — he either has one or he does not.
--
-- Two halves, and the split between them is the one this schema has drawn since
-- the first migration:
--
--   1. NINE COLUMNS ON lead_audits — measurements. Where the Impressum was
--      found, what it names, what the homepage loads. Observations only; the
--      seven judgements they support live in lead_audit_findings and cost no
--      migration, which is the whole point of that table being open.
--
--   2. THREE COLUMNS ON leads — a postal address for the business, in the
--      email sense. Google sells a phone number and almost never an email, so
--      until now written outreach was not possible at all. An Impressum is the
--      one place on the open web where a company address reliably sits.
--
-- ON THE PERSON. §5 TMG requires an Impressum to name a natural person, and
-- every one we read will contain that name. It is deliberately NOT extracted
-- and NOT stored. Company facts are one thing and a named individual is
-- another; nothing in this product needs the second, so it does not keep it.
-- For the same reason the postal address is stored as a boolean and never as
-- text — whether the Impressum states an address is the finding, and the URL
-- beside it is how the operator checks the claim.

-- ---------------------------------------------------------------------------
-- lead_audits — nine observations.
--
-- Nullable throughout, and null means "not established" rather than "no", which
-- is the rule the checker already holds itself to. A site that never answered
-- has not told us it lacks an Impressum, and a boolean that cannot say so would
-- turn a network timeout into an accusation.
--
-- The state of the lookup itself — found, absent, error, skipped — deliberately
-- gets no column. It rides in `raw.imprint` along with the URLs that were tried
-- and what came back, the same way `raw.freeSubdomain` and `raw.datedMarkers`
-- carry observations that are worth recording and not worth a column. The rule
-- from the enrichment migration still decides it: a measurement earns a column
-- when it carries a value worth showing as proof.
-- ---------------------------------------------------------------------------
alter table public.lead_audits
  add column imprint_url           text,
  add column imprint_has_address   boolean,
  add column imprint_has_phone     boolean,
  add column imprint_has_email     boolean,
  add column imprint_has_vat_id    boolean,
  add column has_privacy_policy    boolean,
  add column loads_external_fonts  boolean,
  add column has_external_maps     boolean,
  add column contact_form_insecure boolean;

comment on column public.lead_audits.imprint_url is
  'Where the Impressum was found. Null when none was found, and also null when the lookup failed — raw.imprint.state is what tells those two apart, and only one of them is a finding.';
comment on column public.lead_audits.imprint_has_address is
  'Whether the Impressum states a street address with a house number and a postal town. A Postfach does not count: it is not an address a summons can be served at. The address itself is deliberately not stored.';
comment on column public.lead_audits.imprint_has_phone is
  'Whether the Impressum states a telephone number. Recorded because it is worth knowing, but it does not on its own make an Impressum incomplete — §5 TMG does not require one.';
comment on column public.lead_audits.imprint_has_email is
  'Whether the Impressum states an electronic address. True also for the obfuscated forms German imprints favour — info(at)firma.de — which satisfy the obligation even though nothing usable can be lifted out of them.';
comment on column public.lead_audits.imprint_has_vat_id is
  'Whether a VAT identification number is stated. A German Steuernummer is not one and does not count. Its absence is often perfectly lawful: §5 Abs. 1 Nr. 6 TMG asks for it only where one exists.';
comment on column public.lead_audits.has_privacy_policy is
  'Whether a privacy policy is LINKED from the pages that were read. Deliberately not "exists and is adequate" — the policy itself is never fetched, and the finding must not claim more than the measurement supports.';
comment on column public.lead_audits.loads_external_fonts is
  'Whether the page pulls webfonts from fonts.googleapis.com or fonts.gstatic.com, which transmits every visitor''s IP address to Google before anything has rendered. Self-hosted fonts do not match, which is the distinction that matters.';
comment on column public.lead_audits.has_external_maps is
  'Whether a Google Maps frame is present IN THE DELIVERED HTML. That is the measurable thing, and it is narrower than "loads without consent": a consent tool injects the frame from JavaScript after the visitor agrees, so it is absent here. The judgement withholds itself when a consent manager was detected.';
comment on column public.lead_audits.contact_form_insecure is
  'Whether a form that collects personal data sits on a page without TLS, or posts to an http:// address from an encrypted one. Null when the page had to be fetched over http because its certificate would not verify — that site is not unencrypted, it is misconfigured, and invalid_certificate already says so.';

-- ---------------------------------------------------------------------------
-- leads — an address to write to.
--
-- On `leads` rather than on the audit, because it is not a measurement of the
-- website's quality; it is a fact about the business that happens to have been
-- found on the website. It survives a re-audit, it belongs beside `phone`, and
-- it is what the CSV export is for.
--
-- Unlike `phone` and the rest of the Google block, this is not volatile data
-- under someone else's terms. We read it off the business's own page, and it is
-- the operator's to keep. `imprint_fetched_at` is here for the same reason
-- `fetched_at` is: a surface showing it must be able to say how old it is.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column imprint_email      text,
  add column imprint_phone      text,
  add column imprint_fetched_at timestamptz;

comment on column public.leads.imprint_email is
  'A company email address read out of the Impressum. Role addresses are preferred over personal ones where a page offers both — better to write to, and less of a person''s data to hold. Never a reconstructed guess at an obfuscated address.';
comment on column public.leads.imprint_phone is
  'A telephone number read out of the Impressum. Kept separately from leads.phone, which comes from Google and is volatile under Google''s terms; this one is ours.';
comment on column public.leads.imprint_fetched_at is
  'When the two columns above were last read off the site. Written only when the lookup actually reached a verdict — a failed fetch leaves a good address alone rather than erasing it.';

-- The filter behind "show me everyone I can write to". Partial, because the
-- question is only ever asked of live leads that have an address at all, and a
-- full index would be mostly rows the query discards.
create index leads_imprint_email_idx
  on public.leads (id)
  where imprint_email is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- leads_library — rebuilt for the three contact columns.
--
-- Only the three. The nine audit columns above are deliberately NOT lifted,
-- which breaks with how this view has treated every previous audit column, so
-- the reasoning belongs here rather than in a commit message:
--
--   - Nothing filters or sorts on them. The audit filters all run through
--     `audit_flags`, which the trigger on lead_audit_findings maintains, and a
--     new finding code joins that array without any help from this view.
--   - Nothing displays them from here. The lead detail reads the audit row
--     directly out of lead_audits, with its own column list.
--
-- So lifting them would add nine columns to every one of the hundred rows in a
-- library page, to be read by nobody. The three `leads` columns earn their
-- place because the has-an-email filter is a predicate on this relation and the
-- table and the export both read the values.
--
-- Dropped and recreated rather than replaced: Postgres cannot add a column to
-- the middle of a view in place, and a recreated view does not inherit its
-- grants — hence the revoke at the bottom, which is not optional.
--
-- It also restates l.lat and l.lng, and the comment on lat, which belong to
-- 20260731130000_leads_geo.sql. Not duplication by accident: two migrations
-- rebuilding one view means the LAST one to run defines it, and a definition
-- that forgot the map's coordinates would take the map offline. Whoever adds
-- the next column to this view inherits the same obligation — copy the current
-- definition forward whole, never the one you remember.
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

  -- Read off the business's own Impressum, not off Google. This is what makes
  -- written outreach possible at all, so it travels with the row.
  l.imprint_email,
  l.imprint_phone,
  l.imprint_fetched_at,

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
comment on column public.leads_library.imprint_email is
  'The company email from the Impressum, carried so that "everyone I can write to" is a predicate here rather than a second query.';

revoke all on public.leads_library from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-audit everything.
--
-- The Impressum cannot be read out of an audit that has already been written;
-- it is a page on the business's server that nobody has fetched yet. So every
-- existing audit has nine null columns and none of the seven new findings, and
-- a null column renders exactly like a clean one — "no Impressum problems
-- found" for a site nobody has looked at. That is the same quiet wrongness the
-- enrichment migration re-queued the whole book over, and it gets the same
-- answer.
--
-- `checker_version` is what makes the two states distinguishable afterwards:
-- audits stamped `measure-2` never looked, `measure-3` looked. The pass drains
-- the queue in slices the next time the library is opened, and old audit rows
-- are left alone — a re-audit has always been a new row, and the history is the
-- point of keeping them.
--
-- COST, because it is real and it is not money: this also re-runs the PageSpeed
-- stage for every lead. With GOOGLE_PAGESPEED_API_KEY set that is 25,000 free
-- calls a day and the book will drain in slices over a few days; without a key
-- it will meet the shared rate limit and reschedule itself through
-- psi_retry_after, which is the behaviour that limit was built for.
-- ---------------------------------------------------------------------------
update public.leads
   set enrichment_state      = 'queued',
       enrichment_queued_at  = now(),
       enrichment_started_at = null,
       enrichment_error      = null
 where deleted_at is null;
