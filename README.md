# Lead Engine

Find local businesses whose web presence is weak or missing, judge quickly which are worth
approaching, and keep that judgement alive across weeks.

One operator, one account. Not a CRM and not a scraper — the distinguishing mechanism is a
hard split between two kinds of data, enforced everywhere:

- **Search results** are transient. Pulled live from the Google Places API, cached briefly,
  expired automatically by a database job.
- **Saved leads** are permanent. Audit findings, score, notes, outreach status. This is the
  operator's own work product and it survives indefinitely.

Saving is always an explicit act. See `PRODUCT.md` for the product's own account of itself
and `DESIGN.md` for the interface it is built in.

---

## Setup

Requires Node 20 or newer and a Supabase project.

```bash
npm install
cp .env.example .env.local
```

Then fill in `.env.local` — the sections below say where each value comes from — apply the
migrations, and start the server:

```bash
npm run dev            # http://localhost:3000
```

### 1. Session secret

```bash
npx auth secret        # writes AUTH_SECRET into .env.local
```

### 2. The one account

There is no sign-up. Two environment variables *are* the account:

```bash
node scripts/hash-password.mjs 'a passphrase of at least twelve characters'
```

It prints a full line to paste into `.env.local`:

```
LEAD_ENGINE_OWNER_PASSWORD_HASH="scrypt:<salt>:<key>"
```

Set `LEAD_ENGINE_OWNER_EMAIL` to the address you will sign in with. Both must be present or
the app refuses every sign-in attempt — a misconfigured instance turns nobody away wrongly,
but it must never let everybody in.

Passing the passphrase as an argument puts it in your shell history. Run the script with no
argument and it reads one line from stdin instead.

### 3. Database

Create a Supabase project, then from **Project Settings → API** take:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` — the secret key, `sb_secret_…`

Both are server-only. Neither is `NEXT_PUBLIC_`: the browser never talks to Supabase, and
authorization lives entirely in this app's own auth gate. Every table has RLS enabled with
no permissive policies and is revoked from `anon` and `authenticated`, so the Data API is
closed even if a key leaks.

### 4. Google APIs

One key for discovery, optionally a second for the audit.

**`GOOGLE_PLACES_API_KEY`** — required. In the Google Cloud console, enable **Places API
(New)** and **Geocoding API**, create a key, and restrict it to exactly those two APIs. The
key is never sent to the browser, so an IP or referrer restriction is not what protects it;
the API restriction is.

Discovery bills at Text Search Enterprise ($35/1000, first 1,000 calls each month free)
because the field mask asks for `websiteUri`, `rating` and `userRatingCount` — the three
signals the whole product is about. See `lib/providers/google-places/skus.ts`, which derives
the price band from the mask rather than hard-coding it.

**`GOOGLE_PAGESPEED_API_KEY`** — optional. PageSpeed Insights answers without a key, on a
much tighter quota shared with everything else on your IP, which in practice means 429s
during a bulk re-audit. With a key the quota is 25,000 requests a day and yours. Enable
**PageSpeed Insights API** and create a *second* key restricted to it — deliberately not the
Places key, because widening that key to a third API would undo the only restriction
protecting it.

Leave it blank and enrichment still works; the pass simply runs one PageSpeed call at a time
instead of four, and rate-limited audits retry with a back-off rather than failing.

### 5. Timezone and the nightly refresh

`NEXT_PUBLIC_OPERATOR_TIME_ZONE` defaults to `Europe/Berlin` and settles what "today" means.
Follow-up dates are plain days; the server decides what is due and the browser decides what
date a button writes. On Vercel the server runs in UTC, so without a stated zone the two
disagree between midnight and 02:00 German time.

`CRON_SECRET` is the credential for `/api/cron/refresh`, which runs nightly and has no
session to authenticate with. Generate one:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

On Vercel, set it in the project's environment variables; the platform sends it as
`Authorization: Bearer $CRON_SECRET`. Leave it unset and that route refuses everyone,
including you — it spends money against the Places API, so an unconfigured deployment fails
closed.

---

## Migrations

Everything the product needs is in `supabase/migrations/`, in filename order.

**The quickest way — one file, no tooling.** `supabase/schema.sql` is every migration
concatenated in order. Open the Supabase dashboard → SQL Editor → New query, paste the whole
file, Run. It takes a few seconds.

Enable **pg_cron** first (Database → Extensions), or the four scheduled jobs below never get
created. The file asks for the extension itself and asserts at the end that the jobs exist,
so a missing pg_cron surfaces as an error rather than as a year of data that quietly failed
to expire.

**Or with the CLI**, which is what you want once the schema starts moving:

```bash
npm i -g supabase                      # once
supabase link --project-ref <your-ref>
supabase db push
```

The migrations are the source of truth; `schema.sql` is generated from them and must be
regenerated when one changes. Both assume an **empty** database — running either twice fails
on the first `create table`, which is intended: they build a schema, they do not reconcile
one. Order matters, because later files drop and rebuild the `leads_library` view on the
widened tables underneath it.

Afterwards, confirm the schema landed:

```sql
select * from public.scheduled_jobs;   -- expect three rows
```

### The scheduled jobs

Four things run in the database rather than in the application, because a retention promise
that only holds while the app is awake is not a promise:

| Job                     | When (UTC) | What                                                          |
| ----------------------- | ---------- | ------------------------------------------------------------- |
| `expire-search-results` | 03:15      | Deletes Google-sourced search results past their retention window |
| `expire-geocode-cache`  | 03:30      | Drops resolved locations past their cache lifetime            |
| `purge-deleted-leads`   | 03:45      | Removes soft-deleted leads past the 30-day undo window        |
| `/api/cron/refresh`     | 04:20      | Re-pulls stale Google data and re-audits on the slow cadence  |

The first three are `pg_cron` jobs scheduled by the migrations that define them. **They
require `pg_cron` to be available to the role running the migrations** — if it is not, the
`cron.schedule()` calls are a no-op nobody notices until a year of Google data has quietly
failed to expire. Migration `20260731090000_refresh_and_backoff.sql` asserts all three are
present and re-schedules any that are missing, with a warning.

Check them at any time:

```sql
select * from public.scheduled_jobs;
```

## Who can reach the database

Nobody but the server, and that is the whole authorization model. Sessions belong to
NextAuth, so there is no Supabase JWT and no `auth.uid()` for a policy to inspect — an
`auth.uid()`-based policy here would match nothing and create the illusion of protection.

Three layers, applied by `20260730180300_lockdown.sql`:

1. **RLS enabled on every table, with no policies.** Zero rows visible to `anon` or
   `authenticated`.
2. **Table privileges revoked** from both roles, so a policy appearing later changes nothing.
3. **Schema `USAGE` revoked** — from `PUBLIC` as well as from the two roles by name. The
   second half is the load-bearing one: Postgres grants `USAGE` on `public` to the `PUBLIC`
   pseudo-role by default and every role inherits it, so revoking from `anon` alone leaves
   `has_schema_privilege('anon', 'public', 'USAGE')` answering true and the layer inert.
   `postgres` and `service_role` are granted explicitly first so the revoke cannot lock out
   the server.

The result is that a leaked publishable key fails at the schema, before it can name a table.
`service_role` — which is what the secret key resolves to — is untouched.

Supabase's security advisor will report "RLS enabled, no policy" on every table. Here that
notice is the desired state, not a finding to fix.

The fourth is a Vercel cron, declared in `vercel.json`, because it has to call Google and
the database cannot. Running elsewhere, point any scheduler at
`GET /api/cron/refresh` with the bearer secret.

---

## How it fits together

```
app/
  (app)/search    transient results — the live feed
  (app)/leads     the permanent library, and one lead's diagnosis
  (app)/outreach  two questions about the library: who is due, who has gone cold
  api/            route handlers; the only doors into the data

lib/
  providers/      the provider boundary. Google Places is one implementation
  search/         discovery, cost ledger and spend ceiling
  enrichment/     the two-stage audit pass and its finding vocabulary
  scoring/        pure arithmetic over stored findings, plus its config
  refresh/        asking Google what has changed, and what that means
  leads/          the library: filters, CSV, dates, the repository
```

Four background passes, all of them drained in slices bounded by the serverless function's
lifetime rather than run to completion:

1. **Enrichment stage one** — fetch each saved lead's site and write the diagnosis. Seconds.
2. **Enrichment stage two** — PageSpeed, which takes twenty to forty seconds per site and is
   rate-limited, so it fills in the same audit row a stage later.
3. **Scoring** — pure, no network; runs after the audit settles.
4. **Refresh** — asks Google what has changed. Nightly, and on demand from a lead's page.

---

## Commands

```bash
npm run dev      # development server
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint
npx tsc --noEmit # typecheck
```

---

## Costs

Every billable request is priced at list before it is sent, authorised against a monthly
ceiling, and recorded in `api_usage` afterwards — successful or not, because Google bills a
500 the same as a 200. The ceiling is enforced *before* each request rather than checked
afterwards; a ceiling enforced afterwards is a receipt.

The refresh pass and the bulk "Refresh from Google" action both run under the same guard and
stop cleanly when it refuses, saying so rather than failing silently. Set the ceiling in the
cost readout on the Search surface.
