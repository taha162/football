# Security review — 17 November 2026

The owner asked for 27 checks: authentication and sessions, secrets, database permissions, HTTPS, passwords, validation, XSS, admin access, logs and alerts, SQL injection, environment variables, rate limits, CORS, headers, cookies, CSRF, password reset, uploads, prices and webhooks, error messages, dependencies, exposed files, the git history, key rotation, a full ranked review, and an attempt to break in.

How it was checked:
- **Code:** read, and searched with scripts. Every server action was checked for validation, every page for function props passed from server to client, every `href` and HTML sink.
- **Local database:** RLS on every table, the grants, every read policy, the storage buckets and the price rules.
- **Git history:** all 145 commits scanned with gitleaks 8.28, plus a pattern search for this project's own keys.
- **Dependencies:** `pnpm audit` for vulnerable packages, and depcheck plus manual search for unused ones.
- **Production build:** its browser files scanned for the server secrets' values.
- **Tests:** unit, database and browser tests, including new ones that attack a local production build.
- **Live site:** read-only requests only (headers, exposed files, admin pages, CORS). No sign-in, no flood, no writes.

**Finding nothing is not proof of safety.** This review could not see the production settings in Vercel and Supabase, or the production database.

## Issues found, ranked by severity

| # | Severity | Issue | What was done | Proof |
| --- | --- | --- | --- | --- |
| M1 | Medium | **Session cookies were readable by page scripts** (not `HttpOnly`). A script that got past the nonce CSP could have copied the refresh token and kept the session. | The cookies are `HttpOnly`, `SameSite=Lax` and `Secure` on https. The browser's live updates and calls get only the short-lived access token (an hour at most) from the new `/api/session`. That route is same-site only, `no-store`, and limited per address. | E2E: the cookies are HttpOnly and absent from `document.cookie`; `/api/session` refuses other sites and visitors. Calls, live updates and chat E2E all pass. |
| M2 | Medium | **Sessions never expired.** The cookies lasted 400 days and were renewed while used. | A sign-in lasts **30 days** at most: the proxy and `/api/session` end the session at Supabase. Cookies lapse after **7 days** without a visit. Local Supabase sets the same. | Unit tests (`src/lib/session-policy.ts`). It reads when the session started from the token's `amr` claim; a test against local Supabase confirmed it survives a refresh. |
| M3 | Medium | **Moderation notes were public.** `profiles.suspension_reason` and `suspended_at` could be read by anyone through the API with the public key. | Visitors and members are granted every profile column except those two (migration 0032). The site names its columns (`src/lib/profile-columns.ts`). | DB test: visitors and members are refused those columns, and `select *`. |
| L1 | Low | **Lockout after 10 wrong tries** (asked: 5). | **5 wrong passwords or 5 wrong codes per account in 15 minutes**, then it waits. Per device stays at 50, because mobile networks share addresses. Migration 0032 updates the stored values; one an admin already changed is left alone. | DB test; E2E: five wrong passwords, then the right one is refused. |
| L2 | Low | **No alert on repeated failures.** Failed sign-ins and password changes weren't logged. | Logs: `sign_in_failed`, `email_code_failed`, `second_factor_code_failed` (with a tag that can't be read back to the address), `password_changed`, `admin_page_requested`, `admin_access_denied`, `session_expired`, `security_alert`. Audit log: password changes and lockouts. **Every admin gets a notification** when an account is locked, at most once an hour per account, showing it masked (`o***@gmail.com`); admins can't mute it. | DB test (only the server may record events; hourly dedupe; can't be muted; moderators not alerted); E2E (the admin is alerted after the fifth wrong password). No password appears in the logs. |
| L3 | Low | **API routes had no rate limits.** The health check queried the database on every request. | All six routes are limited per address. Routes behind a secret count only wrong-secret attempts. Over the limit: 429 with `Retry-After`. The health check shares its database result for 10 s. | Unit tests; E2E: 60 requests pass, the 61st gets 429, and another address is unaffected. |
| L4 | Low | **Next.js 16.4.3** is affected by GHSA-mfr8-8qww-v76h (moderate, information disclosure with `'use cache'`). The site doesn't use `'use cache'`, so it wasn't exposed. | Updated to 16.4.6, with the matching `eslint-config-next`. | `pnpm audit`: no known vulnerabilities. Build and every suite pass. |
| L5 | Low | **`/ar/.env` and similar answered 200**: the "page not found" page, with nothing leaked. The live site does this today. | The proxy answers 404 to dot-files and dot-folders (except `/.well-known/`) and to backup, dump, log, key, config and archive files, under any prefix. | Unit tests (29 paths); E2E (12 paths). |
| L6 | Low | **Reset links and e-mail codes lasted an hour.** | 15 minutes locally (`otp_expiry = 900`). Each already works once. Production needs the dashboard setting (below). | Local Supabase runs with `GOTRUE_MAILER_OTP_EXP=900`. |
| I1 | Info | Four unused packages: `react-hook-form`, `@hookform/resolvers`, `dotenv`, `@vitest/coverage-v8`. | Removed. | Build and suites pass. |
| I2 | Info | A moderate advisory in the lint tooling (`minimatch`, GHSA-g3hv-75wg-m249). It is development-only and never shipped. | A pnpm override to the fixed version. | `pnpm audit`: none; lint passes. |
| I3 | Info | Git history: 4 gitleaks matches, plus one Telegram-shaped token in a unit test that has since been deleted. | All are test data: the local Supabase demo keys (`iss: supabase-demo`), the throwaway test password, and a sample token. **No real key was ever committed.** | gitleaks report; JWT payloads decoded. |

Found along the way: the browser test for the per-device sign-up limit failed once in the full run. The test picks its address from 254 values, and those counts last an hour, so it can land on an address an earlier run already used up. Both tests that send an address now use a random one from the IPv6 documentation range (~4 billion). The local Docker daemon then reached its time limit and, as instructed, wasn't restarted, so the full browser suite wasn't run again after that test change. That run had passed 83 of 84 tests.

## The 27 points

1. **Authentication:** Supabase Auth, an established auth library: bcrypt password hashes, rotating refresh tokens, one-hour access tokens. Sessions now expire (M2). Two-step verification with an authenticator app already existed, and the database enforces it (migration 0027).
2. **Secrets:** none in the code. Server secrets are read only on the server (`server-only`). A scan of the production build's browser files finds none of the values of the service-role key, `CRON_SECRET` or `WHATSAPP_BOT_SECRET`.
3. **Database permissions:** all 47 public tables have RLS. Visitors and members have no direct write on any table; writes go through checked functions. Each read policy limits rows to their owner, or to their role. Tables readable by anyone: `currencies` and `match_series` (public reference data) and `profiles` (public fields only, since M3). There are no views. Storage buckets have size and type limits.
4. **HTTPS:** live, `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Vercel redirects http to https; this couldn't be observed from here, because the sandbox's proxy carries only https.
5. **Passwords:** stored only by Supabase Auth, as bcrypt hashes; the site never stores one. The logger drops any value whose key looks like a password, token, secret, cookie, key, e-mail or phone, and the new logs carry none. The full browser run's server log contains no password.
6. **Validation:** all 112 server actions validate on the server (zod, or explicit checks for the six that take plain arguments). Numbers have bounds of 0 or more; money accepts digits only. The database repeats the checks (constraints such as `price_total >= 0`).
7. **XSS:** user text is rendered as text. The only raw HTML is the site's own two fixed scripts, which carry the nonce. No user HTML is ever shown, so there is nothing to sanitize. The nonce CSP refuses injected script (existing E2E).
8. **Admin pages:** checked on the server three times: the proxy, the admin layout (`requireModerator`) and pages (`isAdmin`), and the database (`require_admin`). E2E covers every admin page as a visitor (307 to sign-in), a member (sent away) and a moderator on admin-only pages (sent to `/admin`). The live site sends visitors to sign-in.
9. **Logs and alerts:** see L2.
10. **SQL injection:** no SQL is built from strings. Queries go through supabase-js and RPCs with parameters; SQL lives in migrations; search input is escaped. The two `.or()` filters use enum or database values.
11. **Environment variables:** the public ones are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (protected by RLS by design), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MAP_PROVIDER` and `NEXT_PUBLIC_MAPBOX_TOKEN` (restrict it to the site's URL). The secret ones are `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `WHATSAPP_BOT_SECRET` and the bot's own. No secret has the public prefix. `.env*` is git-ignored; only `.env.example`, with no values, is tracked.
12. **Rate limits:** sign-in, sign-up, password reset and codes, per device and per account, in the database; 5 failures per account, then a pause (L1). Every API route is limited too (L3).
13. **CORS:** no route sends CORS headers, so other sites' scripts can't read the responses (E2E, and the live site). Supabase's own API allows any origin by design; RLS protects it.
14. **Headers:** CSP (with a nonce per page), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, HSTS. Confirmed on the live site.
15. **Cookies:** `HttpOnly`, `Secure` on https, `SameSite=Lax` (M1).
16. **CSRF:** every form and delete is a Server Action, and Next.js refuses one whose `Origin` isn't the site's own. Proven by E2E: a captured "save settings" request replayed from another origin, with the session attached, is refused ("Invalid Server Actions request") and nothing changes; the same request from the site works. The `SameSite=Lax` cookies already keep browsers from attaching the session to other sites' requests. There is no payment form. A separate token would only repeat this check, so none was added.
17. **Password reset:** each link works once, and lasts 15 minutes after the owner's setting (L6). The reply is the same whether an account exists or not. WhatsApp reset codes last 15 minutes, work once, and count only from the account's own number.
18. **Uploads:** pictures (avatars, teams, venues, conversations, offers) and voice notes. Each is checked on the server by its bytes (JPEG, PNG, WebP; voice formats), with a size limit (5 MB) and a random name. It is stored in Supabase Storage, not the code folder, in buckets with their own type and size limits, and folder-ownership policies decide who may write.
19. **Prices:** a customer's booking sends no price; the database prices it from the venue's rates (DB tests). Staff manual bookings refuse negative prices, and the table requires `price_total >= 0` and `deposit_amount > 0`. **There are no payment webhooks**: the site takes no payments, and deposits are recorded by hand. The two webhooks that exist (cron, WhatsApp) need a secret compared in constant time.
20. **Errors:** production build, no browser source maps, no `X-Powered-By`. Visitors see «حدث خطأ ما» with a reference number only. Actions return error codes, never database messages, and API routes return short codes.
21. **Dependencies:** audited and updated (L4, I2); the build and every suite pass on 16.4.6.
22. **Unused dependencies:** removed (I1).
23. **Sensitive files:** 404 (L5). On the live site today, everything at the root already answers 404.
24. **Git history:** no real secret (I3).
25. **Exposed keys:** none to revoke. Telegram isn't used any more, so the old bot's token is best revoked anyway (below). The rotation steps for every key are in `SECURITY.md` → Secrets handling.
26. **Ranked review:** the table above.
27. **Break-in attempts:** below.

## Break-in attempts

| Attack | Where | Result |
| --- | --- | --- |
| Admin pages as a visitor, a member, a moderator | local build (E2E); live site (visitor) | Refused every time: sign-in, sent away, or sent to `/admin`. |
| Writing tables directly with the public key | local database | Refused: no write grants (DB test). |
| Reading other people's private data through the API | local database | Refused by RLS (DB tests). **Found:** suspension notes (M3), now fixed. |
| Price tampering | code and local database | The booking request has no price; prices come from the database; negative prices and amounts are refused. |
| Guessing passwords | local build (E2E) | The account pauses after 5 wrong tries, even for the right password, and admins are alerted. |
| Flooding an API route | local build (E2E) | 429 after 60 requests a minute from one address. Not tried on the live site. |
| Stealing the session with a script | local build (E2E) | The session cookies are HttpOnly, and an injected `onerror` script is refused by the CSP. |
| Forged request from another site (CSRF) | local build (E2E) | Refused; nothing changed. |
| Another site reading the API (CORS) | local build (E2E); live site | No CORS headers. |
| Exposed files (`.env`, `.git`, backups, dumps, logs) | local build (E2E); live site | 404 locally. Live: 404 at the root; `/ar/.env` gives a 200 "page not found" page, with nothing leaked, until this change is deployed. |
| Secrets in the browser's files | production build | None found. |

## What needs the owner

1. **Run `supabase/migrations/20261117000032_security_review.sql`** in Supabase → SQL Editor. It changes nobody's data and can run twice. Until it runs:
   - the lockout stays at 10 (the stored value wins);
   - alerts are only logged (`security_alert_failed`);
   - suspension notes stay readable.
2. **Supabase → Authentication → Sign In / Providers → Email → Email OTP Expiration: 900** (15 minutes for reset links and e-mail codes).
3. **Telegram:** revoke the old bot's token with @BotFather (`/revoke`), or delete the bot, and remove any `TELEGRAM_*` variables from Vercel. Telegram isn't used any more.
4. **Optional:**
   - On a paid Supabase plan, set the session time-box (720 h) and inactivity timeout (168 h) there too.
   - Add a Vercel Firewall rate-limit rule for `/api/*`, which counts exactly across all of Vercel's copies of the site.
5. **Check production's permissions** with two read-only queries in the SQL Editor. Each must return no rows:
   ```sql
   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
   select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
   ```
6. **Every admin keeps two-step verification on.**

## Left as it is, by choice or for later

- **Sign-up says when an address already has an account.** A deliberate choice for clarity, limited per device. Changing it would hide the reason a sign-up didn't go through.
- **Other unknown pages under `/ar/` answer 200** with the "page not found" page: the page streams before the page knows it's missing. Not a leak; the sensitive ones answer 404.
- **The API limits count per server copy.** For an exact count, add the Vercel Firewall rule (above).
- **An access token already given out stays valid until it expires** (an hour at most), as with any Supabase session.
- **Staff sessions last as long as everyone's.** A shorter limit for admins is possible.
- **Turning on two-step verification doesn't ask for the password again.** Carried over from the last review.
- **The 30-day limit was tested with unit tests**, not by waiting 30 days.

---

## Earlier review — 7 November 2026

The owner asked for a review of ten areas: secrets and API keys; authentication and two-step verification; user permissions; input validation and SQL injection; XSS; HTTPS, sessions and CSRF; rate limiting; dependencies; backups; and security logs. What was found is below, ranked by severity, with the file and the cause, and what was done. Every fix has a test that proves it. The Arabic change log (`CHANGES.md`, items 60–68) describes the same changes for the owner, one commit each.

**Finding nothing in an area is not proof that it is secure.** This review read the code, inspected the local database, scanned the build and the history, and ran tests. It could not see the production configuration (Vercel, Supabase), and no outside penetration test was done.

### Findings

| # | Severity | Area | Where | Cause | Status |
| --- | --- | --- | --- | --- | --- |
| H1 | High | Authentication | `supabase/config.toml` (`[auth.mfa.totp]` off); no support in the app | Every account, admins included, was protected by its password alone. A leaked or guessed admin password gave full admin and moderation access. | **Fixed:** two-step verification with an authenticator app (TOTP), enforced by the database. Needs migration `0027` (**owner's approval**) and the Supabase settings below. |
| M1 | Medium | Rate limiting | `src/server/telegram.ts`, `startTelegramSignupAction` | A Telegram sign-up created the Auth account before any limit was checked. So one device could create accounts without limit; the cleanup job deletes unverified ones only after a day. | **Fixed:** the e-mail sign-up's per-device limit is counted before anything is created. |
| M2 | Medium | XSS | `next.config.ts` (CSP); session cookies | `script-src` allowed `'unsafe-inline'`, so markup that slipped past React's escaping could run script. The session cookie can be read by page scripts: `@supabase/ssr` needs it for live updates, so it isn't `HttpOnly`. One injection would have exposed the session. | **Fixed:** pages get a per-request nonce with `'strict-dynamic'`, and no `'unsafe-inline'` for scripts. |
| L1 | Low | Sessions | `src/lib/supabase/server.ts`, `client.ts`, `src/proxy.ts` | Session cookies had no `Secure` flag. HSTS covers browsers that already saw the header, but not a first visit over plain http. | **Fixed:** `Secure` whenever the site URL is https. |
| L2 | Low | Sessions | `supabase/config.toml` (`secure_password_change = false`) | Any session, however old, could set a new password without the old one. `/reset-password` only needs a session. | **Fixed locally.** Production needs the dashboard toggle (below). An old session now gets "ask for a new link". |
| L3 | Low | Security logs | `src/app/api/cron/route.ts`, `src/app/api/telegram/webhook/route.ts`, `src/server/admin.ts`, `src/lib/throttle.ts` | Refused requests left no trace: a wrong cron secret, an unsigned Telegram update, an admin action without the role, a sign-in limit reached. | **Fixed:** each is logged, without secrets, addresses or e-mails. |
| L4 | Low | Rate limiting | `src/lib/throttle.ts`, `src/lib/phone-verification.ts` | The client address was read in two ways. One of them trusted the first `x-forwarded-for` hop, which the visitor controls. | **Fixed:** one helper, `clientIp()`, which prefers `x-real-ip` (set by Vercel). |
| I1 | Info | Docs | `SECURITY.md` | It said the session cookies were `HttpOnly`, and that the word `service_role` never reaches browser files. Both were wrong (the second only for a message name). | **Fixed.** |
| I2 | Info | Backups | (none) | There was no backup or restore procedure, and Supabase's database backups don't include Storage files. | **Documented:** `DEPLOYMENT.md`, section 14. Not testable from here. |
| I3 | Info | Dependencies | `eslint-config-next` → `minimatch` | One moderate advisory (GHSA-g3hv-75wg-m249, denial of service) in a lint tool. It is development-only and never shipped. `pnpm audit --prod`: no known vulnerabilities. | Left; it goes away when `eslint-config-next` updates. |

Also noted, and left as they are:
- **Sign-up says when an address already has an account.** This is a deliberate choice for clarity. It is limited per device.
- **An e-mailed sign-in link can be opened by someone else** (login CSRF). This comes with any e-mailed link.
- **Supabase accepts the same app code twice within its 30-second window** (checked locally). Wrong codes are limited per account; reuse is decided by Supabase Auth.
- **After sign-out or a password change, an access token already issued stays valid** until it expires, at most one hour (`jwt_expiry`). This is how Supabase Auth works. A shorter expiry is possible.
- **Sessions last up to 400 days while used.** Supabase's time-box and inactivity timeout are paid-plan settings, and are recommended below.
- **Turning on two-step verification doesn't ask for the password again.** Someone holding an open session could turn it on and lock the owner out; an admin reset recovers the account. Follow-up: ask for the password before turning it on.
- **Two-step verification is recommended for staff, not required.** The admin pages show a warning until it's on.

### Checked, and found sound

- **Secrets:**
  - Tracked files and the whole git history were scanned for key and token patterns: no real secret was found. The e2e fixtures hold only the local stack's public demo keys.
  - The production build's browser files (`.next/static`) contain none of the values of the service-role key, `CRON_SECRET` or the Telegram token.
  - `SUPABASE_SERVICE_ROLE_KEY` is imported only behind `server-only`.
- **Permissions:**
  - All 44 public tables have RLS. There are no views.
  - Every `SECURITY DEFINER` function sets `search_path`.
  - Roles live in `user_roles`, which API roles cannot write. Only `admin_set_role` changes it, and admins cannot remove their own role.
  - Staff and team role checks inside the RPCs are correct.
  - Storage policies check folder ownership, and buckets have MIME and size limits (no SVG).
  - The six definer functions open to visitors are public reads.
- **Input validation and SQL:**
  - No SQL is built from strings: the RPCs take parameters.
  - Server actions validate with zod.
  - The two `.or()` filters use values checked against an enum or loaded from the database.
  - Search input has `%`, `_` and `\` escaped or stripped.
  - Uploads are checked by magic bytes.
- **XSS:**
  - No `dangerouslySetInnerHTML` with user content.
  - Notification links are internal paths.
  - E-mail templates contain no user fields.
  - Telegram replies are plain text.
  - `safeNext()` refuses off-site and backslash redirects.
- **CSRF and endpoints:**
  - Server actions are accepted only from the site's origin.
  - Cookies are `SameSite=Lax`.
  - The cron and webhook secrets are compared in constant time.
  - The calendar file endpoint is scoped by RLS.
  - Call relay (TURN) credentials go only to participants of a ringing or active call.
  - No server-side fetch takes a URL from users (no SSRF).

### Two-step verification: how it works

- **Settings → «التحقق بخطوتين»:**
  - Shows a QR code, or the key to paste into the app on the same phone; the first code confirms it.
  - Turning it off takes a current code.
- **Sign-in:** after the password, `/mfa` asks for the code. Until it's accepted, every page sends there (`src/proxy.ts`).
- **The database enforces it** (migration `0027`), so it holds even for someone who calls the API directly with the password:
  - `private.mfa_satisfied()` is true for people without a confirmed app, and for sessions whose token says `aal2`.
  - Every table with RLS, and storage, has a `RESTRICTIVE` policy on it, so the policy can only take access away.
  - `require_user()` refuses with `mfa_required`.
  - The six definer reads that skip `require_user()` treat a password-only session as nobody.
  - Supabase itself also refuses a password change, or removing the app, from such a session.
- **Lost phone:** Admin → Users → «إعادة ضبط التحقق بخطوتين». The database checks the caller is an admin and not resetting their own, records it with the reason in the audit log, and then the server removes the factor.
- **Cost:**
  - The check runs once per query, not once per row.
  - On the venues list, timing stayed within run-to-run noise: 4.5–6.2 ms with it, 7.4–7.5 ms without.
  - The migration ran in 0.1–0.3 s on a database with about 100,000 messages.

### Tests

| Suite | Result | New |
| --- | --- | --- |
| Typecheck, ESLint, i18n check (2,003 keys) | Pass | — |
| Vitest unit | 99 / 99 | CSP and nonces; `clientIp`; `Secure` cookie; refused cron call logged without its secret; two-step rules; password-change messages; the TOTP test helper matches RFC 6238 |
| Vitest database | 125 / 125 | 11 two-step tests: password only sees no rows (not even public lists); every RPC refused; private reads empty; files hidden; after the code everything as before; an unconfirmed set-up changes nothing; every table with RLS carries the rule (so a table added later can't be forgotten); admin reset rules and audit |
| Playwright (desktop + mobile) | 69 / 69 | Telegram sign-up past the limit creates nothing; one CSP per page with a fresh nonce; an injected `onerror=` is refused; two-step from Settings through sign-in, including the API with the password only; admin reset and audit |

The tests were checked to fail without their fix:
- **Telegram limit:** the new test failed against the build before the fix.
- **Database enforcement:** with the database check switched off, 5 of the 10 behaviour tests fail; the other 5 cover behaviour that doesn't depend on it. The eleventh fails when a table with RLS lacks the rule (checked with a temporary table, then dropped).
- **CSP:** the E2E test requires a nonce policy, and the previous header (`script-src 'self' 'unsafe-inline'`) doesn't match it. The injection test itself was run only against the new build.

**Found along the way, and fixed:** the full E2E run failed one test intermittently: a message sent while the connection drops (from the previous PR).
- **Cause:** a race in `src/components/messages/composer.tsx`. Text typed in the few milliseconds between a send finishing and the form clearing itself was replaced by the earlier draft.
- **Reproduced:** 1 failure in 4 repeats under parallel load before the fix.
- **After the fix:** 128 of 128 repeats pass, and the full suite passes.

### What needs the owner

1. **Approve, then run `supabase/migrations/20261106000027_second_factor.sql`** in Supabase's SQL Editor (`DEPLOYMENT.md`, section 14).
   - No data changes, and safe to run twice.
   - Before it runs, the site works, and two-step verification works in the pages, but the database doesn't enforce it.
2. **Supabase → Authentication:**
   - Authenticator app (TOTP): enroll and verify on.
   - Secure password change: on.
   - On Pro: leaked-password protection, and a session time-box or inactivity timeout.
3. **Every admin and moderator turns on two-step verification.** Making it mandatory for staff is a possible next step.
4. **Logs and backups:**
   - Connect a log drain if logs must be kept longer than Vercel keeps them.
   - Keep database backups on, copy Storage files on a schedule, and rehearse one restore (`DEPLOYMENT.md`, section 14).

### Not verified here

- The production settings in Vercel and Supabase: there is no access from this environment.
- Real authenticator apps (Google or Microsoft Authenticator) on a real phone. The tests compute codes with the RFC 6238 algorithm the apps use.
- Backup and restore on the real project.
- Denial of service under heavy load, and social engineering of the admin reset.
