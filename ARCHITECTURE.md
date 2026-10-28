# Architecture

## Overview

```
Browser ──► Next.js (proxy.ts → App Router server components / server actions)
               │  user-scoped Supabase client (cookies, anon key + user JWT)
               ▼
           Supabase PostgREST ──► Postgres
               - RLS: SELECT policies only
               - Writes: SECURITY DEFINER RPCs (business rules, locks, audit, notifications)
           Supabase Auth / Storage / Realtime (messages, notifications)
Scheduler ──► /api/cron (Bearer CRON_SECRET) ──► service role ──► run_scheduled_jobs()
```

**The database is the source of truth for every business rule.** Next.js does input parsing (Zod), UX, rendering and translation. It is never the only guard. Any client that talks to PostgREST directly with a user JWT hits the same rules, because API roles have no table write privileges at all.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Routing / i18n | `src/proxy.ts`, `src/i18n/*` | Locale prefix (`/ar`, `/en`, always present), session refresh, optimistic redirect of signed-out users away from private paths |
| Pages | `src/app/[locale]/**` | Server components; read via the user-scoped client (RLS applies) |
| Server actions | `src/server/**` (`"use server"`) | Parse `FormData` with Zod, call one RPC, map DB error codes, `revalidatePath` |
| Queries | `src/server/*/queries.ts` | Typed selects with explicit FK embeds |
| Domain | `src/lib/domain/*` | Pure TS: money, match status machine, tournament generators/standings, venue constants (unit-tested) |
| UI | `src/components/**` | Design system (`ui/`), feature components; client components only where interactivity requires |
| Database | `supabase/migrations/*` | Schema, constraints, triggers, RLS, RPCs, grants, seed reference data |

### Write path (example: joining a match)

1. `<ActionForm action={joinMatchAction}>` (client) posts `FormData`.
2. `joinMatchAction` validates the UUID and calls `supabase.rpc("join_match")` as the user.
3. `public.join_match` (definer):
   - `private.require_user(true)`: the caller must be signed in, active and onboarded.
   - Applies a rate limit.
   - Locks the match row with `FOR UPDATE`, recounts participants and applies the policy (open / approval / invite, blocks, status).
   - Inserts the participant or a waitlist entry.
   - Calls `private.notify`.
4. Errors are raised as machine codes (`raise exception 'match_full'`). `dbErrorCode` extracts the code, and the form shows `errors.<code>` in the current language.

### Error and message codes

Server actions return `{ ok, message | error, fieldErrors }` codes, never translated text. `messages/{ar,en}.json` hold the strings. `pnpm i18n:check` keeps the two catalogs in sync and verifies static keys used in code.

## Key decisions

- **RPC-only writes and SELECT-only RLS.** This keeps every invariant in one transactional place, with locks, recounts, audit and notifications together. It also makes "trust nothing from the client" structural rather than a convention.
- **Business status machines enforced by triggers.** `match_transition_allowed` and `tournament_transition_allowed` are mirrored in TS (`MATCH_TRANSITIONS`), and a test asserts that the two are equal.
- **Concurrency.** Capacity is protected by row locks plus a partial unique index. Waitlist order comes from an identity sequence assigned under the lock. Double booking is prevented by a GiST exclusion constraint, with a per-field advisory lock to avoid deadlocks. See DATABASE_DESIGN.md.
- **Money is integer minor units** (`bigint`; IQD exponent 0). The per-player share is a ceiling division, and the UI labels it as an estimate. Payments are tracked manually by organizers ("paid (marked)"). No payment is processed.
- **Tournament structure is generated in TS** (round robin, seeded single elimination with byes, groups → knockout). The `save_tournament_fixtures` RPC validates and persists it. Knockout advancement and byes are handled in SQL so results always propagate atomically.
- **Messaging access is derived, not stored.** `private.can_access_conversation` checks match, team, booking, challenge or tournament membership live. Leaving a team therefore removes chat access immediately. Realtime is published for `messages` and `notifications`, and RLS applies to those streams.
- **Cache Components / PPR are not enabled.** Almost every page is personalized (session, RLS-filtered data, locale). Correctness was prioritized over static shells, and `cacheComponents` was left off. Request-scoped memoization uses React `cache` (`getCurrentUser`, `getNow`).
- **Signed-out protection is two-layered.** `proxy.ts` redirects signed-out users from private prefixes with a real 307. Pages also call `requireUser()` and similar helpers, which also handle suspension, onboarding and roles.
- **Maps.** `src/lib/maps.ts` defines a provider abstraction. `none` (the default) shows the address plus an "open in maps" link built from stored coordinates. `mapbox` adds static map images when a token is set. The app never shows a placeholder or fake map.
- **Images.** Uploads are checked server-side by magic bytes and size, and also by bucket MIME and size limits. Paths are `<owner-entity-id>/<uuid>.<ext>`, and storage policies check ownership by path.

## Landing stage (WebGL)

The home page is six scenes (pitch, matches, squad, venues, tournaments, final whistle) scrolling over a live, floodlit stadium rendered in the browser.

- **Content is ordinary server-rendered HTML.** Every figure comes from the database through the same queries the rest of the app uses: `searchMatches`, `listVenues`, `currentTournaments` and `teamsRecruitingByPosition` (`src/server/landing.ts`). Every action is a real link into the real flow (joining happens on the match page, behind sign-in). The canvas is decorative (`aria-hidden`). Nothing on the page waits for it.
- **Engine.** `src/components/stage/engine/*` is plain three.js, loaded with `import()` from the client host (`stage-host.tsx`) only on the home page (about 164 KB gzipped). It is not React Three Fiber: one imperative loop makes on-demand rendering, adaptive quality and full disposal simple. All textures are procedural (grass, markings, ball panels, net, LED boards drawn with the page's own fonts), so there are no image or video assets.
- **Light.** Four towers are spot lights with physically based falloff. Only the key light uses a shadow map (goal frames, flags). The ball's shadows are computed analytically inside three's spot-light loop: one soft shadow per tower, which gives the four-way shadow of football under floodlights. Beams, dust (forward scattering), lamp glow and a lens streak are additive layers. A small PMREM environment of the lamp banks gives the ball its reflections.
- **Ball physics** is a purpose-built rigid-body solver (`src/lib/stage/physics.ts`), not Rapier. It is small, deterministic and covers what matters for a ball on grass: Coulomb friction at the contact (slide, then roll), rolling resistance, drag and Magnus lift, restitution, boards, posts and nets, and sleep. It is unit-tested against analytic results. Flicks use the pointer's release velocity, including coalesced events. Enter or Space on the ball button kicks it.
- **Camera.** No animation library. Scroll position becomes a scene coordinate (scene index plus progress), mapped through a shot list (`poses.ts`) with eased handovers and damping (`src/lib/stage/camera.ts`, unit-tested). Shots use a lens shift to put the subject opposite the text. Portrait screens use separate framings. Arabic mirrors every shot across the pitch's long axis.
- **Opening.** A tiny inline script in the root layout runs before first paint on the landing only. It decides whether the opening plays: once per session, never with reduced motion or Save-Data. A 3.5 s failsafe releases the page if the engine is not running. Any key, wheel, touch or click skips it. It is also dropped automatically below about 11 fps.
- **Adaptive quality.** The starting tier comes from GPU and device hints. A frame governor (median frame time) steps it down at run time. Rendering stops when nothing moves (ambient motion runs at about 30 fps), when the stage is off screen and when the tab is hidden. On WebGL context loss the still image shows, and the scene comes back on restore.
- **Accessibility and motion.** Controls are provided to skip the opening, pause ambient motion (WCAG 2.2.2) and turn sound on. Sound is synthesised with WebAudio, off by default, and created only inside the click. Reduced motion means no opening, no camera travel (scenes cut) and paused ambient motion. Without WebGL, the page shows the illustration `public/media/landing/pitch-night.svg`.

## Known trade-offs

- **404 status with a root `loading.tsx`.** Not-found pages stream after the loading shell, so `notFound()` renders the localized 404 UI with `noindex`, but the HTTP status is 200. Private pages are not affected, because the proxy redirects before rendering.
- **Server-rendered form controls.** Server components cannot pass render functions to the client `FormField`. They render controls with `{...controlProps(name)}`, and `FormField` applies the error aria attributes after hydration. Client forms receive the attributes directly.
- **Distance search** uses a haversine function over venue or match coordinates, without PostGIS. This is adequate for city scale, and PostGIS is the upgrade path.
- **Notifications are in-app only.** E-mail, SMS and push are not implemented. Preferences are stored so that channels can be added later.

## Observability

- `src/lib/log.ts` is a JSON logger that redacts keys resembling secrets, tokens, passwords, cookies, e-mails or phone numbers.
- `GET /api/health` reports app and database reachability.
- Render errors show a digest reference only. Server error details never reach the client.
- `audit_logs` records every administrative and sensitive action, and is readable by admins at `/admin/audit`.
