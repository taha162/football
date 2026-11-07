# Security

## Principles

1. **The database enforces the rules.** Clients, including our own Next.js server, get read access through RLS and write only through RPCs that validate everything.
2. **No secrets in the browser.** Only `NEXT_PUBLIC_SUPABASE_URL`, the anon key, the site URL and an optional URL-restricted Mapbox token are public. `SUPABASE_SERVICE_ROLE_KEY` is imported only by `src/lib/supabase/admin.ts`, which is guarded by `server-only`. A scan of the production build's browser files (`.next/static`) finds none of the values of the service-role key, `CRON_SECRET` or the Telegram token. The word `service_role` appears there once, as the name of an admin message (`service_role_missing`), never as a key. The server uses that client only where the caller was checked first or no person can reach it:
   - `/api/cron` (bearer secret) and the Telegram webhook (secret header);
   - the sign-in limits (`auth_throttle`, executable by `service_role` only) and the phone-to-address lookup at sign-in, after the limit check;
   - the Telegram verification page, for the caller's own httpOnly ticket;
   - conversation pictures and voice notes: uploaded after RLS shows the caller belongs to the conversation, removed only after the database accepted the deletion;
   - moderator tools, under `requireModerator`, and only after the database accepted the action (removing a message, banning a suspended account at the auth layer); admin settings readiness checks, admins only.

   The operator script (`pnpm admin:grant`) also uses the key.
3. **No fabricated state.**
   - No payment is taken or simulated. Organizers mark payments manually, labelled "(marked)".
   - Booking and match states come from the database.
   - Features without a configured provider (maps, SMS, push, e-mail notifications) are absent or shown as unavailable.

## Authentication and authorization

- Supabase Auth with e-mail and password (minimum length 8, configured in `supabase/config.toml`).
- **Session cookies** are set by `@supabase/ssr` and refreshed by the proxy.
  - They are `SameSite=Lax`, and `Secure` wherever the site is served over https (`sessionCookieOptions()` in `src/lib/env.ts`, unit-tested).
  - They are **not** `HttpOnly`: the browser client reads the session to open live updates and calls. So the page's own scripts can read the cookie. The defence against a script that shouldn't be there is the nonce Content-Security-Policy (below), which refuses any script the server didn't send.
  - They last 400 days (the library's default) and are refreshed while used. Signing out, or changing the password, ends the account's other sessions at Supabase. An access token already handed out stays valid until it expires (at most an hour, `jwt_expiry`).
- Server code identifies the user with `auth.getUser()`, which is validated by Auth and memoized per request. It never relies on `getSession()` alone.
- `private.require_user()` rejects anonymous and suspended accounts, and anyone whose session still owes the authenticator-app code (below). It can also require completed onboarding.
- **Changing the password** needs a session younger than a day (`secure_password_change`). The e-mailed reset link starts a fresh session, so the "forgot password" route always works. An older session gets "the link expired, ask for a new one". With an authenticator app, Supabase also refuses a new password (or e-mail) from a session that hasn't passed the code.
- **Two-step verification** (authenticator app, TOTP), optional for everyone and recommended for staff (the admin pages say so until it's on):
  - Turned on in Settings: a QR code, or the key to type into the app on the same phone, then a first code to confirm it. Turning it off takes a current code too.
  - After the password, every page sends to `/mfa` until the code is accepted (`src/proxy.ts`). Sign-in goes there directly.
  - **The database enforces it, not just the pages** (migration 0027). `private.mfa_satisfied()` is true for people without a confirmed app, and for sessions whose token says `aal2`. Every table with RLS, and storage, has a `RESTRICTIVE` policy on it. That policy can only take access away, so people without an app keep exactly the access they had. `require_user()` refuses with `mfa_required`. The six definer functions that read as the person without `require_user()` (`my_phone`, `my_conversations`, `unread_counts`, `entity_conversation_id`, `player_stats`, `quote_booking`) treat such a session as nobody.
  - Wrong codes count towards the per-account code limit (10 in 15 minutes).
  - **Lost phone:** an admin resets it from Admin → Users. The database authorizes the reset (admins only, never their own), records it in the audit log with the reason, and then the server deletes the factor through the Auth admin API. Check the request really comes from the account's owner before resetting.
  - **A table added by a later migration needs the same policy.** A DB test lists every table with RLS that lacks it, and fails until it has it.
  - Tests: 11 DB tests (password only: no rows, not even public lists, every RPC refused, private reads empty, files hidden; after the code: as before; unconfirmed set-up: no change; every RLS table has the policy; admin reset rules and audit). Switching the check off makes 5 of them fail. E2E: turn on, sign out, sign in → code page; other pages wait; straight through the API with the password only: no rows, `mfa_required`, password change refused; wrong code refused; right code → the page asked for; turn off with a code. A second E2E covers the admin reset, the audit row, and the password-only sign-in afterwards.
- **Roles.** `user_roles` has no write privilege for API roles:
  - Only `admin_set_role` (admins only) changes roles. Admins cannot remove their own admin role.
  - Moderators cannot grant roles or suspend admins.
  - The first admin is bootstrapped by an operator with `pnpm admin:grant`, which is audited.
  - DB test: "users cannot make themselves administrators". E2E test: an anon-key insert into `user_roles` is rejected.
- **Resource authorization** is checked inside each RPC:
  - Organizer for match tools; captain or manager for team tools; owner or manager for venue settings; venue staff for bookings.
  - Participant for reviews and results; tournament organizer for fixtures.
  - Pages repeat the checks for UX (redirects), but they are not the guard.
- **Pages that need an account** are listed in `src/proxy.ts`. A signed-out visitor gets a 307 to sign-in, with the return address, before anything renders. E2E (Journey K) checks fifteen of them, and that the public listings stay open.
- **Suspension** blocks every RPC through `require_user` and is recorded in the audit log.
- **Blocking** prevents direct messages, joining the blocker's matches and invitations.

## Input handling

- Zod validation in server actions. Machine error codes are returned, never raw DB errors.
- SQL lives only in migrations. RPCs use parameters and an empty `search_path`. Search input escapes `%`/`_` before `ILIKE`.
- Uploads are checked server-side by size and magic bytes (JPEG/PNG/WebP), stored under random names, and limited by bucket MIME and size. Storage policies check path ownership.
- `safeNext()` only allows same-site relative redirects after sign-in. It parses the address the way the browser will and rejects backslashes and control characters, so `/\t/evil.example` (which a browser reads as `//evil.example`) is refused (unit tests).
- Messages and user text render as text. React escapes them, and `dangerouslySetInnerHTML` is not used for user content.

## Abuse controls

- Per-user rate limits (advisory-locked) for messages, invitations, reports, team creation and organizer limits. Values are in `platform_settings`.
- **Sign-in, sign-up, password reset and e-mail codes are limited per device and per account** (`public.auth_throttle`, settings `auth.*`). Supabase Auth sees every request coming from our server, so its own per-IP limits can't tell attackers apart; the app counts instead.
  - Wrong passwords: 50 per device and 10 per account in 15 minutes. Wrong codes (e-mailed or from the authenticator app): 10 per account in 15 minutes. Sign-ups, by e-mail or by Telegram: 20 per device an hour. Reset e-mails: 10 per device and 5 per account an hour. Code resends: 5 per account an hour. Past a limit the form says to wait; the correct password is refused too until the window passes.
  - A Telegram sign-up is counted **before** its account is created, so requests past the limit create nothing (E2E: with the limit at 2, a third sign-up from one device is refused and exactly two accounts exist).
  - The device is the client IP, read in one place (`clientIp()` in `src/lib/client-ip.ts`). It prefers `x-real-ip`, which Vercel sets to the connecting address. The first `x-forwarded-for` hop is used only as a fallback, because a visitor can put anything first there (unit test). Mobile networks in Iraq can put many people behind one address, so the device limits are generous and admins can raise them.
  - Keys are HMAC-SHA256 of the IP or account (keyed by the service-role key), so the table holds no addresses. Rows older than a day are deleted.
  - The limits need `SUPABASE_SERVICE_ROLE_KEY`; without it they are off and sign-in works unlimited. If the database call fails (for example before migration 0021 is run), sign-in still works and a warning is logged.
  - DB tests: only the server may count; limits, check-only and separate keys; an admin setting overrides the default. E2E: ten wrong passwords, then the right one is refused with the waiting message.
- Reports snapshot the reported content. Moderators can hide (and restore) matches, teams, venues, tournaments and reviews. They can remove a reported chat message: the text is erased and the report keeps a copy. They can also suspend users and resolve reports. Every action is audited and the affected owner is notified. Moderators cannot read conversations; they only see the snapshot attached to a report.
- Contact details (phone and WhatsApp) are shown only for venues, as business contacts. Player e-mails are never exposed (DB test).
- **Booking deposits** move between the customer and the venue directly; the platform only records them.
  - A venue's payment details are a fraud target, because a changed wallet number would divert deposits. Only owners and managers can change them, and every change is audited (DB test).
  - Only venue staff can record a deposit as received or returned, and only the customer can report sending it (DB test).
  - Holding a time without paying is limited. A hold lasts an hour unless the customer reports a transfer. Holds count toward the per-user pending limit (`booking.max_pending_per_user`) and the daily booking rate limit. Staff can say a reported deposit never arrived, which frees the time.

## HTTP hardening

A `Content-Security-Policy` (built in `src/lib/csp.ts`, unit-tested):
- **Pages get a fresh nonce on every response** from the proxy (`src/proxy.ts`). Their `script-src` is `'self' 'nonce-…' 'strict-dynamic'`, with no `'unsafe-inline'`:
  - Next.js reads the nonce from the request's policy and stamps it on its own scripts, and the layout stamps its two first-paint scripts.
  - Scripts those load are trusted (`'strict-dynamic'`).
  - A `<script>` or an `onerror=` handler injected into the page has no nonce and doesn't run.
  - Every `[locale]` page was already rendered per request, so this costs no static optimization.
- **Other responses** (API routes, files) get the same policy without a nonce from `next.config.ts`. Each response carries exactly one policy.
- Styles still allow `'unsafe-inline'`: React writes `style` attributes, which a nonce can't cover. `'unsafe-eval'` is allowed in development only.
- Everything else in the policy:
  - fonts, workers and the manifest from the site itself (plus `data:` fonts and `blob:` workers);
  - pictures from the site, the Supabase project and the map tiles (OpenStreetMap, Mapbox), plus `data:` and `blob:`;
  - voice notes from the site and the Supabase project;
  - connections to the site and the Supabase project (HTTPS and its Realtime socket);
  - no frames and no plugins (`object-src 'none'`); forms post to the site only; `base-uri 'self'`; `frame-ancestors 'none'`;
  - `upgrade-insecure-requests` when Supabase is on HTTPS.

`next.config.ts` also sets:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(self), geolocation=(self)` (voice notes and calls, sharing a location)
- `Strict-Transport-Security` for two years with subdomains (sent always; browsers only honour it over HTTPS)
- `poweredByHeader: false`

E2E (`e2e/security.spec.ts`) checks:
- the headers above;
- one policy per page, with a different nonce on each request;
- that an `onerror=` handler injected into a page is refused, and the violation is reported;
- that a walk through the landing page, venues, matches, notifications and a live conversation reports no CSP violation.

CSRF: server actions are POSTs that Next.js accepts only from the site's own origin. The session cookies are `SameSite=Lax`. The only other POST endpoint, the Telegram webhook, requires its secret header.

Server Action body size is capped at 6 MB.

## Account verification

- **E-mail code:** Supabase Auth issues and checks the code (`verifyOtp`, type `email`). It expires (1 h by default) and resends are throttled. The pending address is kept in an httpOnly cookie, not in the URL.
- **Password reset replies** are the same whether or not an account exists, because Supabase answers unknown addresses without sending anything. The one exception is an e-mail that fails to send. That can only happen for an existing account, and the site reports it rather than claiming the link is on its way.
- **Phone number, confirmed by a Telegram bot (no Meta account):**
  - The webhook accepts only updates whose `X-Telegram-Bot-Api-Secret-Token` header matches the secret registered with Telegram. That secret is derived from `TELEGRAM_BOT_TOKEN` and compared in constant time; the token never leaves the server.
  - The verified number is the contact card Telegram delivers. It counts only when the card's `user_id` is the sender's own and the message isn't forwarded. The user never types the number, so nobody can claim someone else's.
  - A code belongs to the Telegram account that opens it first. Another account sending the same code is refused, and its contact completes nothing.
  - Each Telegram account may try a limited number of codes per hour (setting `telegram.max_codes_per_hour`).
  - Codes are 8 characters from a 31-symbol alphabet (~40 bits), valid for 15 minutes and usable once.
  - The browser holds only a random ticket in an httpOnly cookie, and the database stores its SHA-256.
  - Each client (IP) may hold a limited number of *unfinished* verifications per hour (setting `verify.max_open_per_hour`). Finished ones don't count, so people who share a connection don't block each other.
  - A number can belong to one account only.
  - Registering the webhook (Admin → Settings) is limited to administrators, checked on the server.
  - All verification functions are executable by `service_role` only, and `private.user_phones` is never exposed.
  - Phone accounts use an internal address on the reserved `.invalid` TLD, so no e-mail is ever sent to them.
  - Never-verified sign-ups are deleted by the scheduled job after a day.

## Cron endpoint

`/api/cron` requires `Authorization: Bearer $CRON_SECRET`, which must be at least 16 characters and is compared in constant time. It returns 401 otherwise, and 503 if the service role is not configured.

## Security logs

The server writes one JSON line per event (`src/lib/log.ts`), visible in Vercel → Logs. The logger drops values whose key looks like a password, token, secret, authorization, cookie, key, body, e-mail or phone. These events are logged:
- `auth_limit_reached` (warn): a sign-in, sign-up, reset or code limit was hit. Logged with the limits' names only, never the address or account.
- `cron_unauthorized` (warn): `/api/cron` called without the right secret. Logs whether a header was sent, never its value (unit test).
- `telegram_webhook_rejected` (warn): an update without the right secret header, while the bot is set up.
- `admin_action_refused` (warn): a moderator or admin action refused for lack of the role or the second step. Logs the action, the reason and the account id.
- `second_factor_enabled`, `second_factor_disabled`, `second_factor_reset` (info), and failures of these (error).
- Moderator and admin actions are also kept in the database's audit log (Admin → Audit). Supabase keeps its own Auth log (sign-ins, password and factor changes) in the project's dashboard.

Vercel keeps runtime logs only for a short time, depending on the plan. Keeping them longer needs a log drain (`DEPLOYMENT.md`, section 14).

## Backups

Supabase backs up the database daily on paid plans. How many days are kept depends on the plan, and point-in-time recovery is an add-on. **Database backups do not include Storage files** (avatars, venue and team pictures, conversation pictures and voice notes). How to back up both, and how to rehearse a restore, is in `DEPLOYMENT.md`, section 14.

## Secrets handling

- `.env*` files are git-ignored except `.env.example`, which contains no values.
- Do not paste keys into issues, chats or logs. The logger redacts keys matching password, token, secret, authorization, cookie, key, body, email and phone.
- Rotate the service-role key and `CRON_SECRET` if exposed. Rotation affects only the server environment.

## Privacy

- Profile visibility settings let a user hide their match history and statistics. Statistics respect this (DB test).
- Approximate location from "near me" is used for one query and never stored.
- Account deletion is currently handled by support (see IMPLEMENTATION_STATUS.md). User data is never deleted by tests or scripts.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainers. Do not open a public issue.
