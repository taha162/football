# Security review — 7 November 2026

The owner asked for a review of ten areas: secrets and API keys; authentication and two-step verification; user permissions; input validation and SQL injection; XSS; HTTPS, sessions and CSRF; rate limiting; dependencies; backups; and security logs. What was found is below, ranked by severity, with the file and the cause, and what was done. Every fix has a test that proves it. The Arabic change log (`CHANGES.md`, items 60–68) describes the same changes for the owner, one commit each.

**Finding nothing in an area is not proof that it is secure.** This review read the code, inspected the local database, scanned the build and the history, and ran tests. It could not see the production configuration (Vercel, Supabase), and no outside penetration test was done.

## Findings

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

## Checked, and found sound

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

## Two-step verification: how it works

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

## Tests

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

## What needs the owner

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

## Not verified here

- The production settings in Vercel and Supabase: there is no access from this environment.
- Real authenticator apps (Google or Microsoft Authenticator) on a real phone. The tests compute codes with the RFC 6238 algorithm the apps use.
- Backup and restore on the real project.
- Denial of service under heavy load, and social engineering of the admin reset.
