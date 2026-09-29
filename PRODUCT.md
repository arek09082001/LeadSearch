# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router) + TypeScript, Tailwind, Supabase (Postgres + Auth), deployed to Vercel.
Decided by the user, not delegated.

## Users

Exactly one: the owner-operator, who is also the only account. He uses Lead Engine in
focused prospecting sessions, at a desk, on a wide screen. He occasionally checks a saved
lead or its status from a phone between sessions, but never prospects from one.

His job: find local businesses whose web presence is weak or missing, judge quickly which
are worth approaching, and sell them a website. The tool is a working instrument in a
recurring commercial ritual, not something he browses.

## Product Purpose

Turn an undifferentiated list of local businesses into a short, ranked, personally-annotated
set of people worth contacting — and keep that set alive across weeks.

Success is measured in session throughput and recall: how many candidates he can triage per
sitting without fatigue, and whether a lead he saved two months ago still tells him
everything he needs when he returns to it cold.

## Positioning

Not a CRM and not a scraper. The distinguishing mechanism is a hard split between two kinds
of data, enforced everywhere in the product:

- **Search results** are transient. Pulled live from the Google Places API, cached briefly,
  expired automatically. Most are looked at once and discarded.
- **Saved leads** are permanent. Audit findings, score, notes and outreach status. This is
  the owner's own work product and it survives indefinitely.

Saving is always an explicit act. Nothing enters the leads library automatically. A
neighboring tool that quietly retains everything it fetched could not truthfully copy this,
because the split is a compliance position as much as a product one.

## Operating Context

A session runs roughly: search an area and category → scan results for weak web presence →
save the few worth keeping → later, work the saved leads and record outreach.

Four top-level surfaces. The first three were confirmed by the user at the outset; the fourth
was asked for once there was outreach history worth reading:

- **Search** — transient results. Desktop-shaped; not designed for phone width.
- **Leads** — the permanent library. Expected to reach **thousands** of records, accumulating
  over months, revisited cold. Filtering, sorting, status and search-within-leads are
  load-bearing, and pagination or virtualization is a structural concern, not a later
  optimization.
- **Outreach** — the follow-up queue: who is due, who has gone cold.
- **Outcomes** — what the audit found, measured against how the calls went. Read between
  sessions rather than during one. It reports and never tunes: the weighting stays a decision
  the owner makes by hand, and the surface's other job is to say when there is still too
  little evidence to make it.

## Capabilities and Constraints

- Single-user by construction. One Supabase Auth account, gated further by an owner-email
  allowlist. There are no roles, no sharing, no invitations, no multi-tenancy.
- Google's terms restrict long-term retention of most Place fields; place IDs are the
  exception. Volatile Google data therefore carries a `fetched_at` timestamp and a refresh
  path, and the owner's derived data (audit, score, notes, status) persists independently of
  it. Any surface showing Google-sourced fields must be able to say how old they are.
- Search results must never be presented as though they were saved, and saved leads must
  never silently depend on data the product is not allowed to keep.
- **Undecided, and not to be invented:** the audit criteria and their weighting, the score
  scale, the outreach status vocabulary and its transitions, and how "due" and "cold" are
  computed for the Outreach queue.

## Brand Commitments

Name: Lead Engine. Internal tool, single operator — no external brand obligation, no logo,
no marketing surface.

The user's binding brief for how it should feel:

- Quiet, dense, fast. A cockpit, not a dashboard. Information-first.
- It should feel like a tool that respects his time, not software that wants to impress him.
- Scanning density and legibility at small sizes beat decoration everywhere.
- **Anti-references:** generic SaaS admin templates; CRM dashboards covered in donut charts;
  anything with a purple-to-blue gradient hero.

## Evidence on Hand

None. No customers, no testimonials, no case studies, no benchmarks, no usage data, no
existing brand assets. This is a greenfield internal tool with a single user who is also its
author. Future work must not fabricate social proof, logos, metrics, or customer names —
there is no audience to persuade.

## Product Principles

1. **The split is sacred.** Transient and permanent data are visually and structurally
   distinct everywhere. Ambiguity here is a correctness bug, not a style choice.
2. **Saving is deliberate.** Nothing enters the library as a side effect of looking.
3. **Density is the feature.** More legible records per screen beats more comfortable
   whitespace. Optimize for the tenth minute of a session, not the first impression.
4. **Cold recall over live context.** A lead must be fully legible to someone who last saw it
   two months ago, with no memory of the session that produced it.
5. **Stale data must admit it.** Anything sourced from Google shows its age and offers a
   refresh rather than pretending to be current.

## Accessibility & Inclusion

No user-specific access requirement was established — the audience is one sighted desktop
user who has explicitly asked for small, dense type.

That is a preference about size, not a licence to abandon the floor: contrast must still meet
WCAG AA at whatever size is chosen, every control stays keyboard-reachable with a visible
focus state, and text stays selectable and zoomable. Density is achieved through spacing,
scale and restraint — never by pushing contrast down.
