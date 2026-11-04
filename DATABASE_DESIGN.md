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
| `…0012_whatsapp_verification` | `whatsapp_verifications` (codes, ticket hashes, status), `private.user_phones` (verified numbers, unique), service-role-only functions `wa_create_verification`, `wa_receive`, `wa_get_verification`, `wa_consume_verification`, `wa_auth_email_for_phone`, `wa_cleanup`; `my_phone()` for the signed-in user |
| `…0013_booking_deposits` | Booking deposits: `deposit_status` enum, deposit columns on `bookings`, `venues.deposit_instructions`, held requests in `bookings_no_overlap`, settings `booking.deposit_amount` (5,000) and `booking.deposit_hold_minutes` (60), `report_booking_deposit`, `mark_deposit_refunded`, `set_venue_deposit_instructions`; `request_booking`, `decide_booking`, `cancel_booking`, `create_manual_booking`, `quote_booking` and `field_busy_intervals` updated |
| `…0014_telegram_verification` | Phone verification moves to a Telegram bot. It also works where `…0012` never ran (it then creates the tables) and is safe to run twice, so it can be pasted into the SQL Editor. The table is renamed `phone_verifications` with its rows kept; it gains `tg_user_id` (the account that claimed the code) and `client_ref` (hashed client), and loses `wa_message_id`. The `wa_*` functions are replaced by service-role-only `phone_verify_start`, `tg_link_code`, `tg_receive_contact`, `phone_verify_lookup`, `phone_verify_consume`, `auth_email_for_phone` and `phone_verify_cleanup`. The setting `whatsapp.max_starts_per_hour` is replaced by `verify.max_open_per_hour` (20, unfinished only) and `telegram.max_codes_per_hour` (20) |
| `…0015_phone_numbers_visible` | Verified numbers are also written to `auth.users.phone` / `phone_confirmed_at` (backfilled; a number another auth user holds is skipped), so they show in Supabase's user list. `admin_list_users` returns `phone` and matches searches by number, including the local `07…` form. Safe to run twice |
| `…0016_message_images` | Pictures in conversations: private bucket `message-images` (5 MB, JPEG/PNG/WebP) readable by conversation members and moderators only, no direct uploads; `messages.image_path` (text optional when a picture is sent); `send_message(p_conversation_id, p_body, p_image_path)` checks the picture sits in that conversation's folder; `delete_message` and `admin_remove_message` also drop the picture. Safe to run twice |
| `…0017_location_voice_calls` | Conversations get a shared location (`location_lat/lng/accuracy`, rounded to 6 decimals), voice notes (private bucket `message-voice`, WebM/Ogg/MP4 up to 5 MB, `voice_path` + `voice_seconds` 1–300) and call records (`call_outcome` answered/missed, `call_seconds`). `send_message` takes at most one attachment and checks a voice note sits in the conversation's folder; deleting or removing a message erases what it carried. `my_conversations` adds `last_kind`. Voice calls between the two members of a direct conversation: `calls` (ringing → active → ended / missed / declined / failed, each side checks in every few seconds) and `call_signals` (WebRTC set-up, deleted when the call ends), both readable by the two participants only and in the realtime publication; RPCs `start_call` (busy and block checks, one open call per person, rate limit `calls.max_per_10_minutes`), `answer_call`, `end_call`, `call_heartbeat`, `send_call_signal`; `calls_cleanup` (service role, from `/api/cron`) closes abandoned calls. A finished call writes its line in the conversation; a missed one notifies (`missed_call`). Safe to run twice |
| `…0018_bookings_in_site_only` | Every venue books through the site: `venues.booking_mode` defaults to and is held at `platform` (trigger `venues_book_in_site`), so the contact-only mode is gone; bookability still needs verification (and deposit details while deposits are on). A match at a listed venue can't be marked `external` (trigger `matches_book_listed_venue_in_site`); unlisted places still can. A booking is seen by its customer, the venue's staff and the platform's admins and moderators; admins and moderators also handle any venue's bookings with the staff's powers (`private.require_venue_role` lets them through for booking handling only, and `cancel_booking` treats them as the venue), while venue settings stay the venue's. Safe to run twice |
| `…0019_booking_free_times` | `free_start_times(field, local date, duration)` lists the start times of a day (every 30 minutes) that can be booked, by the same checks as a request (notice, advance, opening hours, `slot_is_free` with the venue's gap). `quote_booking` also returns `conflict` for a taken time (`mine`, `held`, `closed`, `booked`, or `gap` when only the venue's minutes between bookings collide), `held_until` for another customer's unpaid hold, and `gap_minutes`; `available` is unchanged. Nothing is stored. Safe to run twice |
| `…0020_message_edits` | `messages.edited_at`, and `edit_message(id, body)`: the sender corrects a message's text (1–2000 characters) unless it's deleted or a call's record, the conversation is read-only, or either person has blocked the other; the same text changes nothing; rate limited like sending. Members get the change through the realtime publication `messages` is already in. Reports keep their snapshot of the text as reported. Safe to run twice |
| `…0021_security_hardening` | `private.auth_attempts` and `auth_throttle(buckets, record)` (service role only): sign-in failures, sign-ups, password-reset e-mails and e-mail-code failures counted per device (IP) and per account under keyed hashes, refused past limits that are `auth.*` platform settings (admins can change them). The site calls Supabase Auth from its server, so Supabase's own per-IP limits see one address. Also: `report_booking_deposit`, `mark_deposit_refunded` and `set_venue_deposit_instructions` no longer executable by `anon`. Safe to run twice |
| `…0022_iraq_cities` | Every governorate of Iraq as a city (Baghdad, Basra, Erbil, Sulaymaniyah, Kirkuk, Najaf, Karbala, Babil, Dhi Qar, Anbar, Diyala, Saladin, Wasit, Maysan, Al-Qadisiyyah, Muthanna, Duhok, Halabja, with Mosul already there), Asia/Baghdad and IQD, approximate centre coordinates; Mosul moves to third in the list. Areas are added by administrators. Safe to run twice (existing slugs untouched) |

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
- `venues` (verification status, booking mode, buffer, notice, advance window, cancellation deadline, auto-confirm, deposit payment instructions), `venue_staff` (owner/manager/staff), `venue_images`, `venue_fields`.
- `venue_opening_hours`: per weekday. A closing time earlier than the opening time means the venue is open past midnight.
- `venue_pricing_rules`: weekday and time-window overrides of a field's hourly price.
- `bookings`: kind `customer` / `manual` / `block`, status, integer price, `occupied_until` (end plus buffer).
- Deposits on `bookings`: `deposit_amount` (the platform amount, never more than the price) and `deposit_status`. The status runs `pending` → `reported` (customer's reference) → `received`, or ends `forfeited` (customer cancelled), `refund_due` (venue cancelled, or a reported deposit was never checked) or `refunded`. The money goes from the customer to the venue directly; the database records what each side reports, with who and when (`deposit_received_by`, `deposit_refunded_by`, audit log).

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
| Double booking | `bookings_no_overlap`: GiST `EXCLUDE (field_id WITH =, tstzrange(starts_at, occupied_until) WITH &&)` for confirmed/completed/no_show bookings and for requests holding their slot for a deposit. Confirming paths take `private.lock_field(field_id)` (advisory xact lock) first, so concurrent confirmations serialize instead of deadlocking. Overlapping pending requests are declined automatically (`slot_taken`) in the same transaction. Two simultaneous confirmations produce exactly 1 (DB test). |
| Paying twice for one slot | A request that needs a deposit holds its slot inside the exclusion constraint until `expires_at` (one hour; kickoff once the customer reports the transfer), so two customers can never pay for the same time. Every booking write first takes the field lock and runs `private.release_expired_holds`, so an overdue hold is released at once rather than when the scheduled job runs. A trigger on expiry tells the customer, and turns a reported deposit nobody checked into `refund_due`. Ten simultaneous requests plus a staff booking for one slot produce exactly one (DB test). |
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
  - Bookings are visible to the requester, venue staff, and platform admins and moderators (who handle them like venue staff).
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

1. Expire undecided booking requests and notify the requester. For held requests, the expiry trigger sends the deposit-specific notice instead, and marks a reported deposit `refund_due`.
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
