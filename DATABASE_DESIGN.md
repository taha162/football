# Database design

All schema objects are created by the committed migrations in `supabase/migrations` (applied in order; `pnpm db:reset` re-applies them locally). Generated TypeScript types live in `src/lib/supabase/types.ts` (`pnpm db:types`).

| Migration | Contents |
| --- | --- |
| `…0001_foundation` | Enums, currencies/cities/areas, platform settings, profiles, preferences, roles, blocks, rate limiting, audit log, notifications, auth helpers |
| `…0002_teams` | Teams, members, invitations, recruitment listings, join requests |
| `…0003_venues_bookings` | Venues, staff, images, fields, opening hours, pricing rules, bookings (+ exclusion constraint) |
| `…0004_matches` | Series, matches, participants, waiting list, invitations, search, cost split |
| `…0005_opponents` | Opponent requests and challenges |
| `…0006_tournaments` | Tournaments, registrations, fixtures, announcements |
| `…0007_messaging` | Conversations, members, read markers, messages, realtime publication |
| `…0008_results_reviews_reports` | Match results/events, player stats, reviews, reputation, reports |
| `…0009_admin_jobs` | Admin RPCs, `run_scheduled_jobs()` |
| `…0010_storage_reference_grants` | Storage buckets and policies, seed reference data (IQD/USD, Mosul + areas), privileges |
| `…0011_message_moderation` | `admin_remove_message`: moderators erase a reported message (audited, sender notified) |

## Schemas

- `public`: tables (read through RLS) and the RPCs the app calls.
- `private`: helpers that are not exposed through the API. Examples are `require_user`, `notify`, `audit`, `rate_limit`, `lock_field`, `recount_match`, `promote_waitlist` and `rate_events`. A small set of read-only predicates is granted for use inside RLS policies.

## Tables (summary)

**Reference and settings**
- `currencies` (code, `minor_unit_exponent`), `cities` (timezone, currency, active flag), `areas` (per city).
- `platform_settings`: key → JSON value, editable by admins. Seeded keys:
  - leave deadline
  - organizer limits
  - message, report and invitation rate limits
  - booking request expiry and max pending
  - review window and minimum count to display
  - team creation limit

**People**
- `profiles`: public profile. It holds no e-mail.
- `user_preferences`: private. Locale, notification preferences and visibility.
- `user_roles`: `admin` / `moderator`, writable only through admin RPCs or the operator script.
- `user_blocks`.
- `handle_new_user` creates a profile and preferences row for each new `auth.users` row.

**Teams**
- `teams`, `team_members`. A partial unique index enforces exactly one captain per team.
- `team_invitations`, `team_recruitment`, `team_join_requests`.

**Venues and bookings**
- `venues` (verification status, booking mode, buffer, notice, advance window, cancellation deadline, auto-confirm), `venue_staff` (owner/manager/staff), `venue_images`, `venue_fields`.
- `venue_opening_hours`: per weekday. A closing time earlier than the opening time means the venue is open past midnight.
- `venue_pricing_rules`: weekday and time-window overrides of a field's hourly price.
- `bookings`: kind `customer` / `manual` / `block`, status, integer price, `occupied_until` (end plus buffer).

**Matches**
- `match_series` (weekly recurrence), `matches`, `match_participants`, `match_waitlist`, `match_invitations`.
- `matches` carries:
  - Capacity: total, reserved and confirmed counters, guarded by CHECK constraints.
  - Cost: total in integer minor units, `cost_per_player` computed in SQL, and the payment collector.
  - Status, join policy, type, booking link and leave deadline.

**Competition**
- `opponent_requests`, `opponent_challenges`. Only one challenge can be accepted per request.
- `tournaments`, `tournament_teams` (registration order, waitlist), `tournament_matches` (stage, group, round, slot, `next_match_id` and `next_slot` for bracket advancement, bye flag, result status), `tournament_announcements`.
- `match_results`, `match_events` (goals, assists, own goals, clean sheets).

**Communication and trust**
- `conversations` (kind match/team/booking/challenge/tournament/direct; one per entity; `direct_key` unique per user pair), `conversation_members` (only for direct chats; other kinds derive access), `conversation_reads`, `messages` (soft delete).
- `notifications`: type, JSON args, read flag, dedupe key (unique per user).
- `reviews` (player and venue), `reports` (target, category, snapshot of the reported content, status, resolution), `audit_logs`.

## Integrity and concurrency

| Risk | Control |
| --- | --- |
| Match over-capacity | `join_match` / `do_join` lock the match row (`FOR UPDATE`) and recount before inserting. A CHECK keeps `confirmed_count + reserved_spots <= total_players`. 20 simultaneous joins for 5 slots produce exactly 5 confirmed (DB test). |
| Duplicate registration | Partial unique index on `(match_id, user_id)` for active participant statuses, plus the same for the waiting list. |
| Waiting-list order | `seq` identity assigned while holding the match lock. Promotion takes the lowest `seq` (DB test asserts order 1..n). |
| Double booking | `bookings_no_overlap`: GiST `EXCLUDE (field_id WITH =, tstzrange(starts_at, occupied_until) WITH &&)` for confirmed/completed/no_show bookings. Confirming paths take `private.lock_field(field_id)` (advisory xact lock) first, so concurrent confirmations serialize instead of deadlocking. Overlapping pending requests are declined automatically (`slot_taken`) in the same transaction. Two simultaneous confirmations produce exactly 1 (DB test). |
| Booking outside rules | `validate_booking_slot` checks opening hours (including overnight), minimum notice, maximum advance and duration. The price is computed server-side from pricing rules (`price_for_duration`). The client never sends a price. |
| Invalid status changes | BEFORE UPDATE triggers call `match_transition_allowed` / `tournament_transition_allowed`, so every code path is covered. |
| Rate abuse | `private.rate_limit(bucket, max, window)` serialized per user and bucket with `pg_advisory_xact_lock`. |
| Money rounding | Integer minor units only. `split_cost` uses ceiling division, so the surplus is shown, never hidden. |
| Notification spam/duplicates | `private.notify` honours user preferences (except mandatory types) and the `(user_id, dedupe_key)` unique key. |

## Row-level security

- RLS is enabled on every `public` table.
- Policies are SELECT-only. Examples:
  - Public matches are visible unless draft or hidden.
  - Rosters are visible to participants and organizers.
  - Bookings are visible to the requester and venue staff.
  - Notifications are visible only to their owner.
  - Reports are visible to their reporter and moderators.
  - Audit logs are visible to admins.
- `anon` and `authenticated` have `SELECT` only. `INSERT`, `UPDATE` and `DELETE` are revoked on all tables and sequences.
- Every write goes through an RPC with `SECURITY DEFINER` and `SET search_path = ''`. Each RPC uses fully qualified names and starts with `private.require_user()` (or `require_moderator` / `require_admin`).
- `run_scheduled_jobs()` is executable only by `service_role`.
- Guests (anon) may execute only read-only functions (`search_matches`, `quote_booking`, `field_busy_intervals`, stats, ratings).

## Storage

Public-read buckets `avatars`, `team-logos` and `venue-images` each have a 5 MB limit and allow JPEG/PNG/WebP. Write, update and delete policies check that the first path segment is the user's id, a team the user manages, or a venue the user manages.

## Scheduled jobs (`run_scheduled_jobs`)

1. Expire undecided booking requests and notify the requester.
2. Mark confirmed bookings completed one day after they end if the venue did not record an outcome.
3. Close expired recruitment listings and opponent requests.
4. Send match reminders for the next 24 hours, once per match (dedupe key).
5. Auto-complete matches well past their end time, and cancel drafts that never got published.
6. Close tournament registration at the deadline.
7. Housekeeping (old rate events).

The job is idempotent and covered by a DB test.

## Reference data

The seed contains:
- IQD (exponent 0) and USD (exponent 2).
- Mosul (Asia/Baghdad, IQD) and 18 Mosul areas in ar/en.

Area names should be checked by someone local before launch. Area coordinates are intentionally empty until verified. Admins add cities and areas at `/admin/settings`.
