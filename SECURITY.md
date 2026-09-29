# Security Policy

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub instead:
[**Report a vulnerability**](https://github.com/arek09082001/LeadSearch/security/advisories/new)
(or go to the repository's **Security** tab and choose **Report a vulnerability**).

Please include:

- what an attacker can do, and what they need first (a session, the MCP token, network access…)
- steps to reproduce, or a proof of concept
- the commit or version you tested against

The aim is to reply within a week. Once a fix is released, the advisory is published, and
you're credited unless you ask not to be. This is a hobby project maintained in spare time, so
there is no bug bounty.

## Supported versions

Only the latest commit on `master` is supported. There are no release branches. Keep your
instance up to date by pulling `master` and applying any new migrations.

## What's in scope

Lead Engine is a self-hosted, single-user app. Every instance holds its operator's lead data
and API keys, and can spend money against Google and Anthropic. The following are especially
interesting:

- Getting past the sign-in gate (`auth.config.ts`, `proxy.ts`, `lib/api/guard.ts`) or around
  the bearer-token checks on `/api/mcp` and `/api/cron/refresh`.
- Reading or writing the database without the server's secret key, e.g. through Supabase's
  Data API with a publishable key. Every table is meant to be closed. See "Who can reach the
  database" in the README.
- Secrets reaching the browser bundle or the API responses.
- Getting around the spend ceilings or the daily website-check limit.
- Making the server fetch addresses it shouldn't (SSRF) through the website checks.
- Data that should expire (search results, call transcripts) surviving its retention job.

## What's out of scope

- Vulnerabilities in your own deployment's configuration, such as a leaked `.env.local`, a
  weak passphrase, or an unrestricted Google API key.
- Issues in third-party services (Google, Supabase, Vercel, Anthropic). Report those to the
  vendor.
- Missing hardening headers or best-practice suggestions with no demonstrated impact. You're
  welcome to open a normal issue for those.

## If you run an instance

- Restrict your Google API keys to the APIs the README names.
- Use a long passphrase and generate `AUTH_SECRET`, `CRON_SECRET` and `MCP_TOKEN` randomly, as
  the README shows.
- Leave the Supabase lockdown migrations as they are. The security advisor's "RLS enabled, no
  policy" notice is the intended state.
