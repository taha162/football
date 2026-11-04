# Security

## Principles

1. **The database enforces the rules.** Clients, including our own Next.js server, get read access through RLS and write only through RPCs that validate everything.
2. **No secrets in the browser.** Only `NEXT_PUBLIC_SUPABASE_URL`, the anon key, the site URL and an optional URL-restricted Mapbox token are public. `SUPABASE_SERVICE_ROLE_KEY` is imported only by `src/lib/supabase/admin.ts`, which is guarded by `server-only`; a scan of the production build finds neither it, `CRON_SECRET`, the Telegram token, nor the word `service_role` in any file sent to browsers. The server uses that client only where the caller was checked first or no person can reach it:
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

- Supabase Auth with e-mail and password (minimum length 8, configured in `supabase/config.toml`). Sessions use HTTP-only cookies via `@supabase/ssr`, and the proxy refreshes them.
- Server code identifies the user with `auth.getUser()`, which is validated by Auth and memoized per request. It never relies on `getSession()` alone.
- `private.require_user()` rejects anonymous and suspended accounts, and can require completed onboarding.
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
  - Wrong passwords: 50 per device and 10 per account in 15 minutes. Wrong codes: 10 per account in 15 minutes. Sign-ups: 20 per device an hour. Reset e-mails: 10 per device and 5 per account an hour. Code resends: 5 per account an hour. Past a limit the form says to wait; the correct password is refused too until the window passes.
  - The device is the client IP from `x-real-ip` / `x-forwarded-for`, set by Vercel. Mobile networks in Iraq can put many people behind one address, so the device limits are generous and admins can raise them.
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

`next.config.ts` sets:
- a `Content-Security-Policy`:
  - scripts, styles, fonts, workers and the manifest from the site itself (plus `data:` fonts and `blob:` workers);
  - pictures from the site, the Supabase project, and the map tiles (OpenStreetMap, Mapbox), plus `data:` and `blob:`; voice notes from the site and the Supabase project;
  - connections to the site and the Supabase project (HTTPS and its Realtime socket);
  - no frames, no plugins (`object-src 'none'`), forms post to the site only, `base-uri 'self'`, `frame-ancestors 'none'`;
  - `upgrade-insecure-requests` when Supabase is on HTTPS.
  - Scripts and styles allow `'unsafe-inline'`: Next.js inlines its bootstrap scripts, and per-request nonces would make every static page dynamic. User text is escaped by React, and an injected script still can't load code from elsewhere or send data to another site. `'unsafe-eval'` is allowed in development only.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(self), geolocation=(self)` (voice notes and calls, sharing a location)
- `Strict-Transport-Security` for two years with subdomains (sent always; browsers only honour it over HTTPS)
- `poweredByHeader: false`

E2E (`e2e/security.spec.ts`) checks these headers, and that a walk through the landing page, venues, matches, notifications and a live conversation reports no CSP violation.

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
