# Implementation status

Last updated: 2026-10-29. "Verified" means covered by an automated test that passed on this date: unit, DB integration against real Postgres, or Playwright against a production build. Everything was verified locally against the Supabase CLI stack. The owner deploys the site on Vercel; that deployment could not be reached from the development environment (network policy), so nothing here was verified against it.

## Verification summary

| Check | Result |
| --- | --- |
| `pnpm lint` | Clean |
| `pnpm typecheck` | Clean (TS strict) |
| `pnpm i18n:check` | 1722 keys, ar/en in sync, all static keys resolved |
| `pnpm test:unit` | 45 passed (domain rules, ball physics, camera and quality logic) |
| `pnpm test:db` | 71 passed (concurrency, RLS, RPC rules, jobs, WhatsApp verification) |
| `pnpm build` | Succeeds (Next.js 16.4, Turbopack) |
| `pnpm e2e` (production build) | 35 passed: 33 desktop, 2 mobile (Pixel 7, Arabic RTL) |

## Features

Legend: ✅ implemented and verified by automated tests · 🟡 implemented, exercised manually or partly covered · ⛔ not implemented

### Accounts and profiles
- ✅ E-mail/password sign-up confirmed with an **e-mailed code** entered on `/verify-email` (resend, clear message when resending too soon); sign-in before confirming leads back to the code page — E2E A and verification spec.
- ✅ **WhatsApp verification without paid messages:** the user sends a one-time code from their own WhatsApp to the platform number; the signed Cloud API webhook activates the account and links the sender's number. Sign-in with phone + password, password recovery by sending a code from the same number, one account per number — DB (7 tests) and E2E with signed webhook payloads. **Not yet tested against Meta's real service** (needs the owner's Meta app and number); hidden until its env vars are set.
- ✅ Sign-out, onboarding (city, positions, skill) — E2E A.
- 🟡 Forgot and reset password. Wired to Supabase Auth; requires SMTP in production. Locally, mail goes to the mail catcher.
- ✅ Profile photo upload (magic-byte checked). After the upload, the server checks that storage really serves the picture; if the bucket is private, the upload is undone with a clear message. A picture that fails to load falls back to the original file, then to initials, never a broken-image mark — E2E profile spec (3 tests). Team logos and venue images use the same check and fallback (not E2E-tested).
- 🟡 Profile editing, preferences, notification preferences, visibility of history and stats (stats visibility is DB-tested).
- ✅ Block/unblock users (DB: blocked users cannot join the blocker's matches or message them).
- ⛔ SMS OTP and OAuth providers. Not configured; no UI is shown for them.
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
- ✅ **Landing stage: six scenes over a live floodlit stadium (WebGL).** The scenes are pitch, matches, squad, venues, tournaments and the final whistle. Covered by E2E (`landing.spec.ts`):
  - every action and position link points at the real route;
  - the recruitment figures change with the database;
  - without WebGL, the still image shows and the page stays usable;
  - with reduced motion there is no opening and motion starts paused;
  - the opening releases the page within its failsafe and can be skipped;
  - the ball can be kicked from the keyboard and brought back.

  The ball physics and the camera/quality logic are unit-tested, including the sharpness-first quality tiers: full resolution and antialiasing are kept while grass, dust and shadow detail are shed, and the resolution drops only in the last-resort tier. Visual QA was done in both languages at desktop, portrait tablet and phone sizes, including the opening, all six shots, a flick, context loss and restore, and marker hover and click.

  🟡 **Not verified on real hardware:** all rendering QA ran in headless Chromium with software WebGL (SwiftShader), at the lowest quality tier plus spot checks of the highest. Frame rates on real phones and GPUs, and the governor's thresholds, have not been measured. The synthesised sound was exercised (it turns on and off without errors) but has not been listened to.
- ✅ **Site-wide motion and interaction.** This covers:
  - smooth wheel scrolling, page transitions and a navigation progress line;
  - an entrance on every page: what is on screen rises into place one item after another, streamed pages included, and page titles draw an accent line;
  - scroll reveals below the fold;
  - cards that tilt toward the pointer under a moving floodlight, buttons that pull toward the pointer, ripples on click and tap, and a short vibration on primary actions on Android phones;
  - a small football that follows the mouse on laptops and desktops (never on touch screens);
  - feedback on fields, menus and dialogs, a rolling-football pending state and a celebration on joining a match.

  Buttons, navigation, menu items and cards navigate without the browser's link-address bubble (`LinkButton`, `CardCover`). Search filters update in place instead of reloading the page. All of it honours reduced motion. Covered by E2E (`motion.spec.ts`, `landing.spec.ts`):
  - on a full page load, on-screen content rises into place, including sections streamed in after the document;
  - filters update the list without reloading the document;
  - content below the fold rises in and is never left hidden;
  - nothing is held back with reduced motion;
  - link buttons point at the real routes.

  A scripted QA pass loaded 28 pages (dashboard, lists, detail pages, forms, account, management and admin) on a laptop and a phone viewport in both languages, against the development and the production build. On every page the on-screen content rose in, nothing stayed hidden, nothing overflowed sideways and the console was clean. On the laptop, cards tilted, buttons lifted and the football reacted; on the phone, taps rippled. With reduced motion nothing was hidden or animated, and neither the football nor ripples appeared. On a list page, each of the first 14 keyboard focus stops (header, navigation, filters) showed a ring, and Enter on a link button navigated.

  🟡 **Not verified on real devices, or in Safari or Firefox.** Where view transitions, `linear()` springs or `@starting-style` are missing, content appears without the animation. The guard against animating a browser swipe-back twice relies on `hasUAVisualTransition`, which not every browser reports. iPhones do not vibrate (no vibration API in Safari). Link buttons have no "open in new tab" or "copy link" in the right-click menu (Ctrl/⌘-click and middle-click still open a new tab).
- ✅ Arabic (RTL, default) and English (LTR), with the locale persisted per user and cookie. A first visit opens in Arabic whatever the browser's language — E2E J and mobile.
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
8. There is no CI workflow that runs the tests yet. All checks above were run locally. The owner's Vercel deployment was not inspected from here.

## Next priorities

1. CI: GitHub Actions running lint, typecheck, i18n, unit, DB (Supabase CLI service) and E2E on every PR.
2. Clear the launch blockers above (legal review, support channel, area verification, SMTP, scheduler).
3. Deploy a staging environment (Supabase project + Vercel), run the E2E suite against it, and grant the first admin.
4. E-mail notifications for booking decisions and match changes, respecting the existing preferences.
5. Self-service account deletion and data export.
6. Test the Mapbox static maps with a real (URL-restricted) token; consider interactive maps.
7. E2E coverage for knockout tournaments, realtime chat and the near-me search.
