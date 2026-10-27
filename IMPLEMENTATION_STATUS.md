# Implementation status

Last updated: 2026-10-27. "Verified" means covered by an automated test that passed on this date: unit, DB integration against real Postgres, or Playwright against a production build. Everything was verified locally against the Supabase CLI stack. No hosted environment has been deployed or tested.

## Verification summary

| Check | Result |
| --- | --- |
| `pnpm lint` | Clean |
| `pnpm typecheck` | Clean (TS strict) |
| `pnpm i18n:check` | 1652 keys, ar/en in sync, all static keys resolved |
| `pnpm test:unit` | 28 passed |
| `pnpm test:db` | 64 passed (concurrency, RLS, RPC rules, jobs) |
| `pnpm build` | Succeeds (Next.js 16.4, Turbopack) |
| `pnpm e2e` (production build) | 17 passed: 15 desktop, 2 mobile (Pixel 7, Arabic RTL) |

## Features

Legend: ✅ implemented and verified by automated tests · 🟡 implemented, exercised manually or partly covered · ⛔ not implemented

### Accounts and profiles
- ✅ E-mail/password sign-up, sign-in, sign-out, onboarding (city, positions, skill) — E2E A.
- 🟡 Forgot and reset password. Wired to Supabase Auth; requires SMTP in production. Locally, mail goes to the mail catcher.
- 🟡 Profile editing, avatar upload (magic-byte checked), preferences, notification preferences, visibility of history and stats (stats visibility is DB-tested).
- ✅ Block/unblock users (DB: blocked users cannot join the blocker's matches or message them).
- ⛔ Phone/OTP sign-in and OAuth providers. Not configured; no UI is shown for them.
- ⛔ Self-service account deletion and data export. The settings page says to contact support, but **no support contact is configured yet** (launch blocker).

### Matches
- ✅ Create a match (cost sharing with an integer ceiling split shown as an estimate), publish, edit, confirm, start, complete, cancel. The status machine is enforced by a DB trigger — E2E B, DB.
- ✅ Join, leave, waiting list with automatic promotion, approval and invite-only policies, private matches with invitations, late-withdrawal flag — E2E A and C, DB.
- ✅ Capacity under concurrency: 20 parallel joins for 5 slots produce exactly 5. Deterministic waitlist order. No duplicates — DB.
- ✅ Organizer roster tools: remove with reason, manual payment marking ("paid (marked)"), attendance — E2E B.
- ✅ Weekly recurrence creates separate matches in a series — DB.
- ✅ Server-side discovery filters, title/venue search and pagination — E2E A and mobile.
- 🟡 "Near me" (browser geolocation used for one query, never stored) and distance sort. Implemented; not E2E-tested because geolocation needs coordinates on venues.
- ✅ Results reporting and confirmation, goal/assist events, player stats — DB.

### Teams and opponents
- ✅ Create a team, invite, accept, roles (exactly one captain), leave, remove, join requests — E2E D, DB.
- ✅ Recruitment listings with position filter — E2E D.
- ✅ Opponent requests and challenges. Accepting creates a team-vs-team match. Only one challenge can be accepted — E2E E, DB.

### Venues and bookings
- ✅ Venue listing, fields, opening hours (including past midnight), pricing rules, staff roles — E2E F, DB.
- ✅ Verification workflow: owner requests, moderator verifies. In-app bookings only for verified venues in platform mode — E2E F, DB.
- ✅ Availability and price quote computed server-side. Booking requests, owner confirm/decline, auto-confirm option, cancellation deadline, manual bookings and blocked time, completed/no-show — E2E F, DB.
- ✅ Double-booking prevention (exclusion constraint plus per-field lock). Overlapping requests are auto-declined. Parallel confirmations produce exactly 1 — E2E G, DB.
- 🟡 Venue images (upload/cover/remove) and linking a booking to a match.
- ⛔ Online payment or deposit. Not implemented by design; the UI says to pay the venue directly.

### Tournaments
- ✅ Create, open and close registration, approve or decline (with waitlist), generate fixtures, record results, standings with tie-breakers — E2E H (league), unit (generators, standings), DB (knockout advancement and byes).
- 🟡 Groups → knockout and single-elimination flows in the UI. Generators and SQL advancement are tested; the full UI path is not E2E-tested.
- 🟡 Team-submitted results, organizer confirmation and disputes; announcements.

### Communication
- ✅ Conversations per match/team/booking/challenge/tournament plus direct messages, with access derived from membership — DB.
- 🟡 Realtime updates in the thread view (Supabase Realtime with RLS). Implemented; not asserted by E2E.
- ✅ In-app notifications with dedupe and preferences. Reminders via the scheduled job — E2E A and C, DB.
- ⛔ E-mail, SMS and push notifications. No provider is configured.

### Trust, safety and admin
- ✅ Reports with content snapshot. Moderators hide or restore content, remove reported messages, suspend users and resolve reports. Everything is audited — E2E I, DB.
- ✅ Admins manage roles; nobody can self-promote. The first admin is bootstrapped with `pnpm admin:grant` — DB, E2E K, script run locally.
- ✅ Signed-out and unauthorized access is redirected. Direct table writes with the anon key are rejected — E2E K, DB.
- 🟡 Admin overview stats, users, venues, content, bookings, audit log, platform settings, cities and areas.
- ✅ Player and venue reviews (participants only, once, within the window; no-shows excluded), reputation aggregates — DB.

### Platform
- ✅ Arabic (RTL, default) and English (LTR), with the locale persisted per user and cookie — E2E J and mobile.
- ✅ Mobile layout with bottom navigation and no horizontal overflow on phone widths — E2E mobile.
- ✅ Scheduled jobs (`/api/cron` → `run_scheduled_jobs`) are idempotent — DB.
- 🟡 Health endpoint, structured redacting logs, security headers.
- 🟡 Maps. With `NEXT_PUBLIC_MAP_PROVIDER=none` (the default), the address and an "open in maps" link are shown. With `mapbox` plus a token, static map images appear on venue pages and match discovery. The Mapbox path has **not** been tested, because no token is available. There are no interactive maps.

## Known limitations and launch blockers

1. **Legal text** (`/legal/terms`, `/legal/privacy`, `/legal/safety`) is a plain-language draft. It must be reviewed by a lawyer for Iraqi law before launch.
2. **Support contact** for account deletion and appeals is not configured.
3. **Area list** for Mosul (18 areas, ar/en) needs verification by someone local. Area coordinates are empty.
4. **Production auth e-mail** needs a custom SMTP provider and redirect URLs configured in Supabase.
5. **Scheduled jobs:** `vercel.json` runs `/api/cron` daily (the Vercel Hobby limit). The 15-minute cadence needs the `Scheduled jobs` GitHub workflow secrets or a Vercel Pro schedule.
6. **404 responses** return HTTP 200 with a `noindex` not-found page, because of the root loading boundary (see ARCHITECTURE.md).
7. A React dev-mode warning ("Each child in a list should have a unique key", reported for `Select` in `LocationFields`) appears in the browser console in development. Every option list is keyed and the production build does not report it. The cause has not been identified yet.
8. There is no CI workflow that runs the tests yet. All checks above were run locally. The repo is prepared for Vercel (see DEPLOYMENT.md), but no deployment has been made.

## Next priorities

1. CI: GitHub Actions running lint, typecheck, i18n, unit, DB (Supabase CLI service) and E2E on every PR.
2. Clear the launch blockers above (legal review, support channel, area verification, SMTP, scheduler).
3. Deploy a staging environment (Supabase project + Vercel), run the E2E suite against it, and grant the first admin.
4. E-mail notifications for booking decisions and match changes, respecting the existing preferences.
5. Self-service account deletion and data export.
6. Test the Mapbox static maps with a real (URL-restricted) token; consider interactive maps.
7. E2E coverage for knockout tournaments, realtime chat and the near-me search.
