## What and why

<!-- What does this change, and what problem does it solve? Link the issue if there is one: "Closes #123". -->

## How I checked it

<!-- Steps you took, and screenshots for UI changes (with invented data). -->

## Checklist

- [ ] `npm run lint`, `npx tsc --noEmit` and `npm run build` pass
- [ ] The demo scripts pass (`node scripts/tips-demo.mjs`, `node scripts/transcript-demo.mjs`, `node scripts/assistant-demo.mjs`)
- [ ] Schema changes come as a **new** migration, with `supabase/schema.sql` regenerated (`node scripts/build-schema.mjs`)
- [ ] No real personal data: no real businesses, people, phone numbers, domains or call transcripts in code, fixtures or screenshots
- [ ] No secrets or `.env` files committed
- [ ] Docs (`README.md`, `.env.example`) updated if setup or behaviour changed
