# Security

## Principles

1. **The database enforces the rules.** Clients, including our own Next.js server, get read access through RLS and write only through RPCs that validate everything.
2. **No secrets in the browser.** Only `NEXT_PUBLIC_SUPABASE_URL`, the anon key, the site URL and an optional URL-restricted Mapbox token are public. `SUPABASE_SERVICE_ROLE_KEY` is imported only by `src/lib/supabase/admin.ts`, which is guarded by `server-only`. That module is used only by `/api/cron`, and the key is also used by the operator script.
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
- **Suspension** blocks every RPC through `require_user` and is recorded in the audit log.
- **Blocking** prevents direct messages, joining the blocker's matches and invitations.

## Input handling

- Zod validation in server actions. Machine error codes are returned, never raw DB errors.
- SQL lives only in migrations. RPCs use parameters and an empty `search_path`. Search input escapes `%`/`_` before `ILIKE`.
- Uploads are checked server-side by size and magic bytes (JPEG/PNG/WebP), stored under random names, and limited by bucket MIME and size. Storage policies check path ownership.
- `safeNext()` only allows same-site relative redirects after sign-in.
- Messages and user text render as text. React escapes them, and `dangerouslySetInnerHTML` is not used for user content.

## Abuse controls

- Per-user rate limits (advisory-locked) for messages, invitations, reports, team creation and organizer limits. Values are in `platform_settings`.
- Reports snapshot the reported content. Moderators can hide (and restore) matches, teams, venues, tournaments and reviews. They can remove a reported chat message: the text is erased and the report keeps a copy. They can also suspend users and resolve reports. Every action is audited and the affected owner is notified. Moderators cannot read conversations; they only see the snapshot attached to a report.
- Contact details (phone and WhatsApp) are shown only for venues, as business contacts. Player e-mails are never exposed (DB test).

## HTTP hardening

`next.config.ts` sets:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- a restrictive `Permissions-Policy` (geolocation self only)
- `Strict-Transport-Security` (sent always; browsers only honour it over HTTPS)
- `poweredByHeader: false`

Server Action body size is capped at 6 MB.

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
