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
| Routing / i18n | `src/proxy.ts`, `src/i18n/*` | Locale prefix (`/ar`, `/en`, always present), session refresh, optimistic redirect of signed-out users away from private paths. The browser's `Accept-Language` is ignored, so a first visit opens in Arabic; a language chosen with the switcher is kept in the `NEXT_LOCALE` cookie |
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
- **Images.** Uploads are checked server-side by magic bytes and size, and also by bucket MIME and size limits. Paths are `<owner-entity-id>/<uuid>.<ext>`, and storage policies check ownership by path. After each upload the server requests the file's public URL. If the bucket does not serve it (for example, a bucket that was created private), the upload is removed and the user gets a clear error instead of a broken picture. Pictures render through `StorageImage`: if the optimized copy fails it loads the original, and if that fails too it shows the fallback (initials, a team shield or pitch lines), never a broken-image mark.
- **Build cache.** Turbopack's on-disk cache is off for builds and for `next dev` (`next.config.ts`). With it on, builds reused an old compiled `globals.css`, so new styles were missing, and Vercel restores that cache between deployments.

## Landing stage (WebGL)

The home page is six scenes (pitch, matches, squad, venues, tournaments, final whistle) scrolling over a live, floodlit stadium rendered in the browser.

- **Content is ordinary server-rendered HTML.** Every figure comes from the database through the same queries the rest of the app uses: `searchMatches`, `listVenues`, `currentTournaments` and `teamsRecruitingByPosition` (`src/server/landing.ts`). Every action is a real link into the real flow (joining happens on the match page, behind sign-in). The canvas is decorative (`aria-hidden`). Nothing on the page waits for it.
- **Engine.** `src/components/stage/engine/*` is plain three.js, loaded with `import()` from the client host (`stage-host.tsx`) only on the home page (about 164 KB gzipped). It is not React Three Fiber: one imperative loop makes on-demand rendering, adaptive quality and full disposal simple. All textures are procedural (grass, markings, ball panels, net, LED boards drawn with the page's own fonts), so there are no image or video assets.
- **Light.** Four towers are spot lights with physically based falloff. Only the key light uses a shadow map (goal frames, flags). The ball's shadows are computed analytically inside three's spot-light loop: one soft shadow per tower, which gives the four-way shadow of football under floodlights. Beams, dust (forward scattering), lamp glow and a lens streak are additive layers. A small PMREM environment of the lamp banks gives the ball its reflections.
- **Ball physics** is a purpose-built rigid-body solver (`src/lib/stage/physics.ts`), not Rapier. It is small, deterministic and covers what matters for a ball on grass: Coulomb friction at the contact (slide, then roll), rolling resistance, drag and Magnus lift, restitution, boards, posts and nets, and sleep. It is unit-tested against analytic results. Flicks use the pointer's release velocity, including coalesced events. Enter or Space on the ball button kicks it.
- **Camera.** No animation library. Scroll position becomes a scene coordinate (scene index plus progress), mapped through a shot list (`poses.ts`) with eased handovers and damping (`src/lib/stage/camera.ts`, unit-tested). Shots use a lens shift to put the subject opposite the text. Portrait screens use separate framings. Arabic mirrors every shot across the pitch's long axis.
- **Opening.** A tiny inline script in the root layout runs before first paint on the landing only. It decides whether the opening plays: once per session, never with reduced motion or Save-Data. A 3.5 s failsafe releases the page if the engine is not running. Any key, wheel, touch or click skips it. It is also dropped automatically below about 11 fps.
- **Adaptive quality, sharpness first.** The starting tier comes from GPU and device hints. A frame governor (median frame time) steps it down at run time. Every tier but the last renders at the full pixel ratio (up to 2) with antialiasing: under load the governor sheds grass blades, dust and shadow-map resolution first, and lowers the resolution only in the last-resort `rescue` tier (also the start for software renderers). Canvas textures (boards, labels, glows) are drawn at twice their layout size with 16× anisotropic filtering. Rendering stops when nothing moves (ambient motion runs at about 30 fps), when the stage is off screen and when the tab is hidden. On WebGL context loss the still image shows, and the scene comes back on restore.
- **Accessibility and motion.** Controls are provided to skip the opening, pause ambient motion (WCAG 2.2.2) and turn sound on. Sound is synthesised with WebAudio, off by default, and created only inside the click. Reduced motion means no opening, no camera travel (scenes cut) and paused ambient motion. Without WebGL, the page shows the illustration `public/media/landing/pitch-night.svg`.

## Motion and interaction

The whole site shares one set of motion tokens (`src/app/globals.css`): durations, an ease-out for feedback, a press curve, and a damped spring written as CSS `linear()` (damping ratio 0.62, 8% overshoot). All of it honours `prefers-reduced-motion`: CSS through the global block, scripted motion by checking the media query.

- **Smooth scrolling.** Lenis eases wheel scrolling of the window (`src/components/motion/motion-root.tsx`). Touch and keyboard scrolling stay native, nested scroll areas (the chat, wide tables) scroll themselves, and reduced motion turns the easing off. A navigation ends any glide still running, so it cannot pull the new page away from where the router placed it. The landing camera now follows the eased scroll more closely (its own damping went from 4.5 to 6).
- **Page transitions.** `PageTransition` wraps each page in a React `<ViewTransition>` keyed by the path. Every navigation, detail pages included, is therefore an exit and an enter: the old page fades out in 150 ms and the new one fades in over 260 ms while its content rises into place (see Reveals). Changing only the query (filters) or refreshing data keeps the page in place. The header, the phone navigation bar and the progress line are named, so they hold still above the moving pages. When the rest of the page is unaffected, React keeps it live by shrinking the transition layer to 0×0. On right-to-left pages that layer must be pinned to the left (`::view-transition { right: auto }`): otherwise it anchors to the right edge and every animated group renders off-screen, so the screen is blank for the whole transition. The loading skeleton fades out as streamed content arrives, and full page loads cross-fade (`@view-transition`). A swipe back that the browser has already animated is not animated a second time (`hasUAVisualTransition`).
- **Navigation progress.** A 2 px line runs along the top while the next page loads. It starts on internal link clicks and GET form submissions, appears only after 120 ms, and completes when the address changes, with a 10 s safety stop.
- **Search forms** use `next/form` with `action=""` and `scroll={false}`. Filters update the results in place instead of reloading the document, and the URLs are unchanged.
- **Entrance.** On every full page load, what is on screen rises into place one item after another (`.reveal`, the children of `.reveal-children`; page titles draw an accent line under themselves). An inline script at the top of `<body>` (`enter-script.ts`) hides that content before first paint and animates it without waiting for hydration. Most pages stream: the document finishes with the loading skeleton on screen and React swaps the page in a moment later, so the script keeps watching and animates sections as they are swapped in, until `reveal.ts` announces it has taken over. A failsafe shows everything after 2.5 s.
- **Reveals.** Content below the fold rises in the first time it is scrolled to. Content that arrives on screen later (a navigation, new results) rises at once, in reading order. Reveals use IntersectionObserver and Web Animations, never classes or attributes, because the first scan can run before React has hydrated the server-rendered markup. Printing shows everything.
- **Link buttons.** Controls that look like buttons, the navigation, menu items and dashboard tiles navigate without showing the browser's link-address bubble: they are anchors with `role="link"` and no `href` (`LinkButton`, `src/components/ui/link-button.tsx`). Click, tap and Enter navigate through the router. Ctrl/⌘/Shift-click and a middle click open a new tab. Targets are prefetched when they scroll into view and again on hover or focus. Whole-card clicks use the same mechanism (`CardCover`): a layer over the card navigates, and the card's title keeps an ordinary link underneath for keyboard, screen-reader and search-engine users. Footer links and links inside text stay ordinary links. The cost: these controls have no "open in new tab" or "copy link" in the right-click menu.
- **Pointer and touch.** One delegated listener (`pointer-fx.ts`) drives:
  - list cards that tilt toward the pointer (up to 7°), lit by a floodlight that follows it, with an accent ring and a slight zoom of their image;
  - buttons (all but the quiet ghost style) that pull toward the pointer and lift;
  - a ripple from the point of contact on buttons, cards, chips and menu rows (mouse and touch);
  - on phones, a short vibration on primary actions where the browser supports it (Android Chrome; iOS has no vibration API).
- **Cursor football.** On devices with a fine pointer that can hover (laptops, desktops), a small football follows the mouse on a spring (`cursor-ball.tsx`). It rolls by the distance it travels, grows and glows over anything clickable, squashes when pressed and gets a small kick when released. The normal cursor stays. It hides over text fields and over the stadium's own ball, and touch screens never show it.
- **Micro-interactions.**
  - Buttons press to 94% and spring back, the primary button sweeps a shine on hover, and the focus ring closes in on them. Some icons answer hover: the plus turns, the bell rings, the message, shield and language icons hop, and the logo turns.
  - Fields glow on focus and their label turns accent. On a validation error, the page glides to the first invalid field, which shakes; error alerts pop in and shake.
  - In the desktop navigation, a highlight glides between items and the current section is underlined. The phone bar lights a segment of its top line, and its icons bounce on tap.
  - Dialogs rise with a spring while the page behind dims. The account menu grows from the avatar, and its items nudge forward on hover.
  - Pending buttons show a rolling football, and unread counts pop when they change.
- **Celebration.** Joining a match or accepting an invitation can end in the server-rendered "You're in" state. When it does, the tab that sent the action throws a short burst of lime and white flecks (Web Animations with exact drag and gravity). It is keyed by match and armed only for 20 s after that tab's submission, so reloading or arriving any other way shows nothing.

## Known trade-offs

- **404 status with a root `loading.tsx`.** Not-found pages stream after the loading shell, so `notFound()` renders the localized 404 UI with `noindex`, but the HTTP status is 200. Private pages are not affected, because the proxy redirects before rendering.
- **Server-rendered form controls.** Server components cannot pass render functions to the client `FormField`. They render controls with `{...controlProps(name)}`, and `FormField` applies the error aria attributes after hydration. Client forms receive the attributes directly.
- **Distance search** uses a haversine function over venue or match coordinates, without PostGIS. This is adequate for city scale, and PostGIS is the upgrade path.
- **Page transitions briefly hold named elements.** While a page transition plays (about 0.45 s), the browser does not deliver clicks to the named participants: the arriving page, the header and the phone bar. A tap in that window can miss. Transitions are kept short for this reason.
- **Notifications are in-app only.** E-mail, SMS and push are not implemented. Preferences are stored so that channels can be added later.

## Observability

- `src/lib/log.ts` is a JSON logger that redacts keys resembling secrets, tokens, passwords, cookies, e-mails or phone numbers.
- `GET /api/health` reports app and database reachability.
- Render errors show a digest reference only. Server error details never reach the client.
- `audit_logs` records every administrative and sensitive action, and is readable by admins at `/admin/audit`.
