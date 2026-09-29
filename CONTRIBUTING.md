# Contributing to Lead Engine

Thanks for taking the time. Bug reports, fixes, documentation and new features are all
welcome. This file covers how to get a working copy, what a pull request has to pass, and the
few rules that aren't obvious from the code.

## Before you start

- **Small fixes** (typos, obvious bugs, docs) can go straight to a pull request.
- **Anything bigger** (a new feature, a new dependency, a schema change, a new provider):
  please open an issue first so we can agree on the shape before you spend the time.
- Read [`PRODUCT.md`](PRODUCT.md). The product is built around a few principles, and changes
  that break them will be sent back however good the code is:
  - Search results are **transient** and saved leads are **permanent**. The two never mix.
  - Nothing enters the library as a side effect. Saving is always an explicit act.
  - Anything sourced from Google shows its age.
  - Every billable request is priced up front and held to a ceiling.
- The app is **single-user by design**: one instance, one operator. Multi-user or
  multi-tenant support would change the whole authorization model (see "Who can reach the
  database" in the README). Open an issue before starting on it.

## Local setup

Follow [Setup in the README](README.md#setup). In short you need Node 20.9 or newer, a
Supabase project (the free tier is enough) and a Google Places API key.

The call assistant and the recogniser default to `mock`, so you need neither an Anthropic key
nor a microphone to work on them. The three demo scripts run without any keys, database or
network access:

```bash
node scripts/tips-demo.mjs        # plays two calls and asserts the live tips
node scripts/transcript-demo.mjs  # exercises the mock recogniser
node scripts/assistant-demo.mjs   # prints what the mock assistant would say
```

### Next.js 16

This project runs on Next.js 16, which renames and changes APIs you may know from earlier
versions (for example, `middleware.ts` is now `proxy.ts`). Before you write Next-specific code,
check the docs that ship with the installed version in `node_modules/next/dist/docs/`, not
older tutorials. The same goes for AI coding assistants. [`AGENTS.md`](AGENTS.md) tells them so.

## Checks

CI runs all of these on every pull request. Run them locally first:

```bash
npm run lint
npx tsc --noEmit
npm run build
node scripts/tips-demo.mjs
node scripts/transcript-demo.mjs
node scripts/assistant-demo.mjs
node scripts/build-schema.mjs && git diff --exit-code supabase/schema.sql
```

There is no unit test framework yet. If your change is pure logic (scoring, triggers, filters,
the site check), a demo-style script that asserts its results is the current way to cover it.
A proposal for a proper test setup is welcome as an issue.

## Database changes

- **Add a new migration and never edit an existing one.** Existing instances have already
  applied the old files. Name it `supabase/migrations/<YYYYMMDDHHMMSS>_<what>.sql`, so that it
  sorts after the newest one.
- **Regenerate `supabase/schema.sql`** with `node scripts/build-schema.mjs` and commit it
  together with the migration. CI fails if the two drift apart.
- **Lock down every new table** the way the existing migrations do: enable RLS, add no
  policies, and `revoke all ... from anon, authenticated`. The browser never talks to Supabase.
  The server's secret key is the only way in.
- If the table holds Google-sourced data, give it a `fetched_at` and an expiry path. If it holds
  anything a person said, give it a retention job.

## Data that must never be committed

This project handles other people's data, so the repository must never contain any of it:

- **No real call transcripts or recordings**, not even partial or "anonymised" ones. The person
  on the other end did not agree to being published. If a real call shows a gap in the rules,
  write a new fixture that keeps its shape (timing, segment breaks, the moments that matter) in
  invented words. See the header of `lib/transcript/fixtures/logistics.ts`.
- **No real businesses or leads** in fixtures, demos, screenshots or issues. Use invented
  names, the reserved `.example` domain for websites (`https://elektro-brenner.example`) and
  phone numbers ending in `000000`.
- **No secrets.** `.env.local` is git-ignored. Keep it that way. If you ever commit a key by
  accident, rotate it. Removing it from the history is not enough.

The same applies to issues and pull request descriptions. Redact names, domains and phone
numbers from logs and screenshots before posting them.

## Code style

- TypeScript in strict mode, ESLint with the Next.js config. Run `npm run lint`.
- Match the surrounding code. Comments in this codebase explain *why* a decision was made,
  often at length. Keep that habit for anything that isn't obvious.
- Server-only modules import `server-only`. API keys never get a `NEXT_PUBLIC_` prefix.
- Code, comments and docs are in English. Text the operator reads or says during a German call
  (the tips, briefings and summaries) stays in German.
- Add a dependency only when it earns its place, and say why in the pull request.

## Pull requests

- One topic per pull request. Small ones get reviewed faster.
- Describe what changed and why, and how you checked it. Add a screenshot for UI changes, with
  invented data.
- Keep the branch up to date with `master`. A merge commit is fine.
- By contributing, you agree that your contribution is published under the project's
  [license](LICENSE).

## Reporting bugs and asking for features

Use the issue templates. For a bug, the most useful things are the steps to reproduce it, what
you expected and what happened, and your Node version and deployment target (local, Vercel,
other). **Security problems go through [SECURITY.md](SECURITY.md), not public issues.**
