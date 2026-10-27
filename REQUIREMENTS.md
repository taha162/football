# Requirements

Scope as built. Each rule names where it is enforced. "DB" means a Postgres constraint, trigger or SECURITY DEFINER RPC, so it holds for every client.

## Market and platform

- Launch city: Mosul. Timezone Asia/Baghdad, currency IQD (no minor units). Cities and areas are data, added by admins. Each city has its own timezone and currency.
- Languages: Arabic (default, RTL) and English (LTR). Every user-facing string is translated, and URLs are always locale-prefixed. The user's preferred locale is stored and applied at sign-in.
- Usable on phones (bottom navigation, no horizontal overflow) and on desktop.
- Money is stored as integer minor units with an ISO currency. Displayed amounts are formatted per locale.

## Roles

| Role | Granted by | Can |
| --- | --- | --- |
| Guest | — | Browse public matches, teams, venues, tournaments, legal pages; sign up |
| Player (any signed-in, onboarded user) | Sign-up | Join, organize, create teams, book, message, review, report |
| Team captain / manager | Team creation, captain | Manage roster, invitations, recruitment, opponent requests, tournament registration |
| Venue owner / manager / staff | Venue creation, owner | Owner/manager: venue settings, fields, hours, pricing, staff. Staff: bookings |
| Tournament organizer | Tournament creation | Lifecycle, approvals, fixtures, results, announcements |
| Moderator | Admin | Reports, hide/restore content, remove messages, verify venues, suspend non-admins |
| Admin | Admin, or the operator bootstrap script | Everything moderators can do, plus roles, settings, cities/areas and the audit log |

Users can never grant themselves a role (DB).

## Business rules

### Matches
- Status flow: `draft → open ⇄ full → confirmed → in_progress → completed`. `cancelled` is reachable from any non-final state. Transitions are checked by a DB trigger.
- Capacity is `total_players`. `reserved_spots` are held back by the organizer, and `confirmed + reserved ≤ total` (DB CHECK and recount under a row lock).
- Join policies:
  - `open`: confirm immediately when a slot is free, otherwise join the waiting list.
  - `approval`: request stays pending; no slot is consumed until approved.
  - `invite_only`: invitation required.
- When a confirmed player leaves, the first person on the waiting list is promoted automatically and notified. If nobody is waiting, a full match reopens.
- Leaving after the match's leave deadline (default 6 h, configurable) is recorded as a late withdrawal.
- No one can join draft, cancelled, completed or past matches. Suspended, non-onboarded and blocked users cannot join.
- Cost per player is `ceil(total_cost / total_players)` and is labelled as an estimate. The organizer records payment status manually; no payment is processed.
- Only the organizer edits, confirms, cancels or removes players. Capacity cannot shrink below the confirmed roster. Cancelling notifies participants and waiting players.
- Organizers may have at most N upcoming matches (setting).

### Teams
- Exactly one captain (DB partial unique index). The captain can promote managers. A captain must transfer captaincy before leaving while other members remain.
- Invitations and join requests use pending/accepted/declined/revoked states. Recruitment listings expire.
- Teams created per user per day are rate-limited.

### Opponents
- A team publishes a request (format, time window, area, optional venue, cost per team). Other teams send challenges.
- Accepting a challenge creates a `team_vs_team` match and closes the request. At most one challenge per request is accepted (DB).

### Venues and bookings
- Venues start unverified. In-app bookings are possible only when the venue is **verified** and in `platform` mode. Otherwise the venue is contact-only.
- A slot must be:
  - inside opening hours (overnight supported)
  - at least `min_notice_minutes` ahead
  - no more than `max_advance_days` ahead
  - an allowed duration
- The price comes from the field rate and pricing rules (server-side); the client never sends it.
- Confirmed, completed and no-show bookings on a field may not overlap, including the venue's changeover buffer (DB exclusion constraint).
- When one request is confirmed, overlapping pending requests are declined automatically with reason `slot_taken`.
- Requests expire if undecided within the configured hours. Customers may cancel until the cancellation deadline; venue staff may cancel any time with a reason.
- Staff can record manual (phone/walk-in) bookings and blocked time. These are subject to the same overlap rule.

### Tournaments
- Formats: league (round robin), single-elimination knockout (seeded, byes) and groups → knockout.
- Status flow: `draft → registration_open → registration_closed → in_progress → completed`, plus `cancelled` (DB trigger).
- Registration requires a minimum team size. Approval is limited by capacity, and extra teams go to the waiting list.
- Fixtures are generated once from the approved teams. Knockout winners (and byes) advance automatically.
- Standings: points per win, draw and loss as configured. Ties are broken by goal difference, goals scored, head-to-head, wins, then registration order.
- Teams may submit results for organizer confirmation, and opponents may dispute them.

### Communication and notifications
- Every match, team, booking, challenge and tournament has a conversation. Access follows current membership. Direct messages are blocked between users who blocked each other.
- Messages are rate-limited (default 20/min). Senders can delete their own messages, and moderators can remove reported ones.
- Notifications are in-app, deduplicated and filtered by user preferences. Notifications that change someone's plans are mandatory: cancellations, match changes, waitlist promotion, booking decisions and cancellations, removal from a match, and account notices. Reminders go out 24 h before a match.

### Results, reviews and reports
- Match results and events (goals, assists, own goals, clean sheets) feed player statistics. A player can hide their history and stats.
- Reviews are allowed only between participants of a completed match (and for the venue), once each, within the review window (default 14 days). No-shows cannot review or be reviewed. Aggregates appear after a minimum count.
- Reports carry a category, details and a snapshot of the reported content. Reports are rate-limited, with one open report per reporter per target.

## Non-functional requirements

- **Security:** see SECURITY.md. Server-side enforcement, RLS everywhere, no secrets in the client, every admin action audited.
- **Integrity under concurrency:** capacity, waitlist order and booking overlaps hold under parallel requests (DB-tested).
- **Honesty:** no fake data, success states, payments or integrations. Unconfigured providers are absent or labelled.
- **Accessibility:**
  - Semantic landmarks and a skip link.
  - Labelled form controls, with errors linked through `aria-describedby`.
  - Dialogs use the native `<dialog>`.
  - Visible focus.
  - Colour contrast on the dark theme.
- **Performance:** filtering and pagination happen server-side. Images use `next/image` (remote Supabase storage). Indexes back the main queries.
- **Observability:** health endpoint, structured logs with redaction, error digests.
- **Testability:** domain logic is pure TS. Business rules are tested against real Postgres. Key journeys are covered E2E on desktop and mobile.
