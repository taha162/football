# Performance audit — 6 November 2026

What was measured, what changed, and what could not be measured. Every number below was measured as described in [How it was measured](#how-it-was-measured); nothing is estimated. Where a measurement was not possible, it says so. The Arabic change log (`CHANGES.md`, items 52–59) describes the same changes for the owner, one commit each.

## Summary

| # | Item | Outcome |
| --- | --- | --- |
| 1 | Indexes and query plans | Done: migration `…0026_read_performance` (**not applied to production: needs the owner's approval**) |
| 2 | N+1 queries | None found in the app; the database-side equivalent (per-row work before sorting) fixed by item 1 |
| 3 | Selective columns | Done where it matters (venue lists in forms); the remaining `select("*")` reads are single rows or short lists, left as they are (reasons below) |
| 4 | Pagination | Every paged list now has a unique tie-breaker (`id`) |
| 5 | Image formats and sizes | Already WebP at responsive widths through `next/image`; AVIF deliberately not enabled |
| 6 | Lazy loading / LCP | First-screen venue covers load at once (venues list LCP −112 ms with photos); the venue page's cover is preloaded at high priority |
| 7 | CDN and caching | Long-lived caching for content-addressed files; dynamic pages stay uncached |
| 8 | Concurrent fetches | Five pages fetch independent data together; measurably faster where the page's own chain was the longest (venue dashboard −107 ms at 40 ms per round trip) |
| 9 | Loading states | Skeleton only after one second; no flash on quick navigations, which also finish ~250 ms sooner |
| 10 | Optimistic updates | Text messages appear at once (Slow 4G: 512 → 201 ms), with a pending mark and automatic rollback |
| 11 | AI streaming | Not applicable: the site has no AI features |
| 12 | Benchmarks | Slow 4G + 4× CPU, same routes, old and new alternating: creating a match −684 ms LCP, a tournament −460 ms, other routes unchanged; no physical device available |

## How it was measured

- **Machine:** a 4-core Linux cloud container. The app ran as a production build (`next build` + `next start`, Next.js 16.4) against the local Supabase stack (PostgreSQL 17.11).
- **Data:** national-size test data in the local database: 2,449 visible venues, 10,877 matches, 20,689 bookings, 6,900 profiles, 100,876 messages, 56,948 notifications.
- **Browser:** headless Chromium driven by Playwright, iPhone 13 profile. Throttling was set through the DevTools protocol, the same mechanism as DevTools' presets: **Slow 4G** (150 ms latency, 1.6 Mbit/s down, 750 kbit/s up) and **4× CPU slowdown**. Each run used a fresh browser context (cold cache). The tables give the median of 3 runs unless stated.
- **Caveat on TTFB:** in this headless Chromium, the emulated latency is not added to time-to-first-byte, though the bandwidth limit does apply to the document. TTFB below is therefore the server's own time. FCP and LCP include the throttled transfer of everything else.
- **Before vs after:** "before" is the code at `main` (commit `913aefb`), "after" is this branch, both as production builds on the same (migrated) database. Page benchmarks (items 6 and 12) ran both builds side by side, alternating load by load. Item 8 alternated requests, and item 10 measured both builds in the same session. Item 9's navigation measurements ran on the old build, then on the new one, under the same conditions. The database's own before and after are the query plans of item 1.
- **Database plans:** `EXPLAIN (ANALYZE, BUFFERS)` inside transactions that were rolled back, run as the role the API uses (`authenticated` with the person's JWT claims), warm cache.
- **Not available:** the deployed site (its host is outside this environment's network allowlist), production Supabase and Vercel metrics, and a physical low-end phone. No production numbers are given anywhere below.

## 1. Database indexes and query plans

**How the slow queries were found.** `pg_stat_statements` was reset, every page was crawled as a guest, a player and an admin (warm cache), and the statements were ranked by mean time. `auto_explain` (local only, since reset) logged the plans of anything over 3 ms. The worst offenders, mean per call:

| Statement (as the API sends it) | Mean |
| --- | --- |
| Admin bookings list (`bookings` with venue, court, customer embedded) | 599.6 ms |
| `search_matches` (three kinds of search) | 75.7 / 66.4 / 20.1 ms |
| Venues list (three variants) | 35.3 / 28.2 / 24.9 ms |
| Teams list (two variants) | 21.4 / 20.4 ms |
| Venue with its courts | 20.4 ms |
| Admin content: matches | 18.6 ms |

**What the plans showed.**
- *Row-level security evaluated per row.* Sixteen read policies called `private.is_moderator()` / `private.is_admin()`, security-definer functions the planner cannot inline, once for every row. Some called a per-row function first (`bookings`: `private.is_venue_staff(venue_id)` for all 20,689 rows before sorting).
- *Embedded relations computed before the limit.* PostgREST turns `select=*,venue:venues(...)` into lateral joins. Unless an index already yields the `ORDER BY`, PostgreSQL computes every row's embedded data, then sorts, then keeps 30. With an index in the list's order it reads 30 rows and stops.
- *One generic plan for every search.* `search_matches` used the catch-all pattern (`p_city_id is null or city_id = p_city_id`) with a `CASE` in `ORDER BY`. As a SQL function its plan was generic, so no index could serve "upcoming matches in any city, by start time".
- *A function that could not be inlined.* `private.distance_km` had a `SET search_path` clause, which stops a SQL function from being inlined, so "near me" called it twice per match.

**What changed** (`supabase/migrations/20261106000026_read_performance.sql`):
1. The sixteen policies keep their conditions but test the person's own row first, then the role check wrapped as `(select private.is_moderator())`, which PostgreSQL evaluates once per statement (an InitPlan), then any per-row function.
2. Four indexes, each in its list's order and ending in `id`:
   - `venues_listing_idx (verification_status desc, name, id) where not is_hidden`
   - `teams_listing_idx (created_at desc, id desc) where not is_archived and not is_hidden and visibility = 'public'`
   - `bookings_created_idx (created_at desc, id desc)`
   - `matches_created_idx (created_at desc, id desc)`

   No blanket foreign-key indexes: none of the measured queries needed one.
3. `search_matches` became plpgsql that runs the same SQL text through `execute … using`. Each call gets a custom plan, so empty filters fold away and the default order becomes `starts_at, id`, which the upcoming-matches index serves. Same 21 parameters.
4. `private.distance_km` lost its `SET` clause (it is a pure, invoker-rights arithmetic function, so `search_path` cannot affect it), so it is inlined.
5. `admin_list_users` orders by `created_at desc, id desc` (item 4).

**Same results.** Every policy change was checked with each persona (guest, player, venue owner, moderator, admin): the same rows from every affected table, compared before and after. `search_matches` was compared on 8 kinds of search: same rows, same order.

**Plans before and after** (`EXPLAIN ANALYZE`, execution time):

| Query | Before | After |
| --- | --- | --- |
| Admin bookings, first page | 335 ms | 12.8 ms (policies only) → 0.4 ms (with index) |
| Match search, any city | 47.9 ms | 0.74 ms |
| Match search, one city | 13.4 ms | 0.60 ms |
| Match search, format + second page | 46.7 ms | 0.76 ms |
| Match search, time of day | 39.6 ms | 1.9 ms |
| Match search, by text | 56.1 ms | 19.5 ms |
| Match search, by date | 11.9 ms | 6.9 ms |
| Match search, best match | 12.9 ms | 6.9 ms |
| Match search, nearest (with coordinates) | 113 ms | 10.5 ms (same distances) |

**Write cost.** Every insert into a table now also updates its new index. Each table's rows were copied into two temporary tables, one with the index and one without (median of 3 rounds):

| Index | Rows | Extra time per row written | Size |
| --- | --- | --- | --- |
| `bookings_created_idx` | 20,725 | 1.0 µs | 840 kB |
| `matches_created_idx` | 10,929 | 1.2 µs | 472 kB |
| `venues_listing_idx` | 2,475 | 1.6 µs | 176 kB |
| `teams_listing_idx` | 723 | 0.6 µs | 56 kB |

Temporary tables skip the write-ahead log, so a real insert costs more in total. The index's own share is of this order: microseconds per row written, against milliseconds saved on every read. The indexed columns are fixed once a row exists (creation time, `id`) or change rarely (a venue's name, verification or visibility), so most updates touch none of them and stay eligible for HOT updates.

## 2. N+1 queries

None found in the application. No query runs inside a loop or per item of a list: the only per-item `await` (`my/bookings`, calendar links) formats text and touches no database. Lists fetch their related data in one request with Supabase nested selects (for example, a match card with its venue, city and organizer). The database-side equivalent was there: embedded relations computed for every row before the sort and limit. Item 1's indexes fix it.

## 3. Selective columns

- The venue lists in forms were the one large read. Forms now fetch only one city's venues (`id, name, city_id` plus active courts' `id, name`). The team page and the challenge form need names only, so they now fetch `id, name` with no courts (`venueNames`).
- Twenty reads still use `select("*")`. **Left as they are, deliberately.** Each is a single row (a profile, a conversation, the message about to be deleted, so its files can be removed), a reference table (19 cities, the areas), or a list of at most 50 rows whose page uses nearly every column (a conversation's messages, a tournament's fixtures). Several results are cast without a compile-time column check, so trimming them risks silently dropping a field a page needs, for a few hundred bytes.

## 4. Pagination

Every paged list has a unique last sort key, so rows that tie on the visible order (two notifications in the same instant, two venues with the same name) keep one order from page to page, and none can repeat or be skipped:
- the venues, teams and notifications lists, "my bookings", and teams recruiting players;
- in the admin area: bookings, content (matches, teams, tournaments), the audit log, venues, reports, and users (inside `admin_list_users`).

The new list indexes end in the same `id`, so the tie-breaker costs nothing extra on those lists. A check with 61 notifications at the same instant found no repeated or skipped row on page 2, with or without the tie-breaker, both under the planner's own plan and with sorting forced. PostgreSQL happened to return the ties in one order. SQL makes no such promise without a unique last key, and another plan or more data could change it. The tie-breaker makes the order guaranteed; no actual bug was observed.

## 5. Image formats and sizes

Already in place, so no change was needed. Uploaded pictures (venue covers and galleries, team logos, avatars) go through `next/image` (`StorageImage`). It serves WebP at the width each `sizes` attribute asks for (`deviceSizes`/`imageSizes` srcsets), and the original file is the fallback if the optimized copy can't be produced (`StorageImage` retries unoptimized, then shows a placeholder). The site's own artwork is SVG, and the landing stadium is WebGL.

- **AVIF not enabled, deliberately.** Next.js documents AVIF as about 20% smaller than WebP but about 50% slower to encode. The first visitor to each picture and width would wait longer, and every picture would be stored twice (one copy per format). WebP is supported by every current browser.
- **Local caveat:** the local storage server is on `127.0.0.1`, which Next.js 16 refuses to fetch for optimization (SSRF protection). So `StorageImage` serves local pictures unoptimized (`isLocalStorageHost`). Production storage is a public host and is optimized. For the measurements in item 6, both builds were therefore rebuilt in throw-away copies with `images.dangerouslyAllowLocalIP` and optimization on, as in production. Those two lines are not in the branch.

**Checked** on the optimization-enabled builds, with a synthetic 1600×1000 JPEG of 388,809 bytes standing in for a phone photo. The optimizer returned `image/webp`: 17,582 bytes at 640 px wide and 43,794 bytes at 828 px.

## 6. Loading strategy and LCP

- **Venues list:** the first four cards, the first screen on a phone, now load their covers at once (`loading="eager"`). The rest stay lazy, as before (`next/image` defaults to lazy).
- **Venue page:** the cover, the page's largest element, was already preloaded. `priority` became `preload` because Next.js 16 deprecates `priority`; both compile to the same tags (`preload: preload || priority` in `next/dist/shared/lib/get-img-props.js`). New: the cover is also requested at high priority (`fetchPriority="high"`). The reason is measured below.
- Nothing above the fold is lazy. Everything below it still is.

**Measured** with test covers on 12 venues (the 1600×1000 photo above):
- builds with optimization on, as in production (item 5);
- the optimizer's cache warmed first, as after a CDN's first visitor;
- Slow 4G + 4× CPU, iPhone 13, old and new alternating, median of 5.

| Page | Old LCP | New LCP |
| --- | --- | --- |
| Venues list (12 covers) | 2,580 ms (2,276–2,604) | **2,468 ms** (2,276–2,472) |
| Venue page (its cover is the LCP) | 3,032 ms (2,968–3,036) | 3,048 ms (3,012–3,124) |

**The venue page needed two fixes.** The first measurement of this branch showed its cover painting 76–100 ms later than before, with the same bytes, server time and markup. The waterfall showed why: on the saturated link a 74 KB script now finished about 15 ms before the 111 KB cover and ran first on the slowed CPU. Two changes followed, each measured:
- **The navigation skeleton is no longer sent with every page.** It is built when a navigation first starts, so the HTML is back to its old size. The cover then started downloading as early as before (about 530 ms).
- **The cover is preloaded at high priority** (`preload` with `fetchPriority="high"`). After this the page matched the old build: ranges overlap, medians 16 ms apart.

Next.js's docs generally suggest `loading="eager"` with `fetchPriority="high"` instead of `preload`. That variant measured 3,116 ms here (old: 2,968 ms), so it was not used.

## 7. CDN and caching

Vercel serves `/_next/static/*` from its CDN with `Cache-Control: public, max-age=31536000, immutable`. File names there carry a content hash, so a new deployment means new names, and nothing needs invalidating. Pages stay dynamic and uncached (`private, no-cache, no-store`), because they depend on who is signed in. Every change of content is visible on the next request, and live updates arrive over Realtime. What changed:

| What | Before | After |
| --- | --- | --- |
| Landing fallback image (84 KB, shown where WebGL is unavailable) | `/media/landing/pitch-night.svg`, `public, max-age=0`: revalidated on every visit | imported from `src/assets`, so it gets a hashed `/_next/static/media/…svg` name and is served `public, max-age=31536000, immutable` |
| Optimized pictures (`/_next/image`) | `public, max-age=14400, must-revalidate` (4 hours, Next.js's default `minimumCacheTTL`) for a file stored with an hour | `public, max-age=2678400, must-revalidate` (31 days). A file uploaded with the new year-long setting gets `max-age=31536000` (checked on both builds). |
| Uploaded files (storage objects) | `cache-control: max-age=3600` (the client's default) | `max-age=31536000` |

Why long caching is safe: every upload gets a new random file name (`randomFileName`), so an address always means the same bytes. A replaced picture has a new address, and the old one is never shown in its place. The public copy of `pitch-night.svg` stays, so nothing that links to it breaks.

## 8. Concurrent fetches

Independent requests that waited for each other now run together, in five pages:

| Page | Before (sequential) | After |
| --- | --- | --- |
| Venue page | the page's queries, then the deposit settings | deposit settings run alongside them |
| Book a venue | venue, then deposit settings | together |
| Venue dashboard | venue, then your role, then deposit settings; on the bookings tab, three queries one after another | all three together; the tab's three together |
| Team management | team, then its members | together |
| Notifications | the page of notifications, then the unread ones | together |

Error handling is unchanged. These functions return `null`, an empty list or default settings when the database fails, rather than throwing (`getVenue`, `myVenueRole`, `getDepositSettings`, `getTeam`, `getTeamMembers`, and the Supabase queries themselves). So `Promise.all` meets no rejection the sequential code did not meet, and each page handles a missing result as before.

**Measured** with every request from the app server to the database delayed by 40 ms (a Node preload shim on `fetch`, standing in for the network between Vercel and Supabase). Both builds ran side by side on the same database, requests alternating, 15 per page. The table gives the median time until the whole page had been sent. The shim's effect: the notifications page took 46 ms without it and 299 ms with it.

| Page | Before | After |
| --- | --- | --- |
| Venue dashboard (bookings tab) | 419 ms | **312 ms** |
| Team management | 326 ms | 317 ms |
| Venue page | 313 ms | 315 ms |
| Book a venue | 312 ms | 313 ms |
| Notifications | 309 ms | 307 ms |

Only the venue dashboard got measurably faster. Its own chain was six requests in a row, now two rounds. Each of the other four pages had a chain of two or three requests. Their whole response took about 310 ms, nearly eight round trips at 40 ms. So something else set their time, before and after: the session check and the layout's own requests (the signed-in person, the header's counts) run before or alongside the page. Finishing the page's part sooner therefore did not end those responses sooner. The change stays, because it costs nothing and helps whenever the page's part is the slower one, but no speed-up is claimed for those four pages.

## 9. Loading states

**Before:** a root `loading.tsx` put a skeleton in place of the page at once on every navigation, however quick, so quick navigations flashed it. Two view transitions ran back to back (page → skeleton → page).

**After:**
- **Navigating:** there is no `loading.tsx`, so the current page stays until the next one is ready, then hands over in one transition. The 2 px progress line still starts after 120 ms. It now also covers navigations started in code: buttons and cards (`LinkButton`, `CardCover`), the "near me" button and the landing stadium's markers (`announceNavigation`).
- **Past one second:** the page skeleton covers the window between the header and the phone navigation bar. The old page is hidden but keeps its place, so nothing shifts. `#main` gets `aria-busy`, and a polite live region says «جارٍ التحميل…». The skeleton is removed in the same commit that brings the new page, before the view transition captures it, so it never appears in the transition.
- **First visit:** the page still streams behind a Suspense boundary in the layout, and its skeleton stand-in stays invisible for its first second (`.page-fallback`). Unlike a `loading.tsx`, Next.js does not show this boundary on navigation.
- No artificial delay was added anywhere. The skeleton shows only when the wait is real.

**Measured** per animation frame from the tap (iPhone 13, signed-in player, median of 3; before = `main`, after = this branch, same database and conditions):

| Navigation | Condition | Skeleton shown at | Skeleton visible for | Main area without a page | New page at |
| --- | --- | --- | --- | --- | --- |
| Bottom bar → venues | unthrottled | 102 → never | 276 → 0 ms | 276 → 0 ms | 378 → 132 ms |
| Venue card → venue | unthrottled | 97 → never | 321 → 0 ms | 321 → 0 ms | 418 → 130 ms |
| Bottom bar → venues | Slow 4G + 4× CPU | 246 → never | 400 → 0 ms | 400 → 0 ms | 632 → 608 ms |
| Venue card → venue | Slow 4G + 4× CPU | 254 → never | 391 → 0 ms | 391 → 0 ms | 668 → 600 ms |
| Bottom bar → venues | page data held back 1.5 s | 101 → 1,069 ms | 1,520 → 552 ms | 1,520 → 564 ms | 1,618 → 1,621 ms |
| Venue card → venue | page data held back 1.5 s | 98 → 1,062 ms | 1,530 → 568 ms | 1,530 → 579 ms | 1,628 → 1,630 ms |

The unthrottled navigations now finish about 250 ms sooner because there is a single view transition instead of two. Prefetching was unchanged: the venues list made 5 prefetch requests before and after (10.9 → 9.7 KB).

**Tests:** `e2e/motion.spec.ts`:
- a quick navigation shows no skeleton and never an empty main area in its first second;
- a page held back 2.5 s keeps the old page at 0.5 s, shows the skeleton (busy and announced) only after 1 s, then the page, with nothing left behind.

## 10. Optimistic updates

**Chosen action: sending a text message.** It is low risk: nothing is lost if it fails, because the text goes back to the box, and nothing is shown that the person did not do. Pictures, locations and voice notes keep the old flow. They wait for the upload, and an optimistic copy of a file is not worth its risk.

- The message joins the conversation at once, dimmed, marked «جارٍ الإرسال…», and the box is free for the next one (`useOptimistic` in `thread.tsx`).
- It gives way to its sent copy, which may arrive over Realtime before the action finishes. The match is one-to-one: the next message of mine with the same text, newer than anything there was when it left. So two identical messages sent in a row are counted correctly.
- **Rollback:** when sending fails, or the connection drops, which used to throw the page into the error screen, the pending copy disappears. The text returns to the box, followed by anything typed meanwhile, and the reason is shown.
- Screen readers hear the message once, when it has really been sent. The pending copy is `aria-hidden`, and the list is a live region.

**Measured** per animation frame after the tap on «إرسال» (iPhone 13, median of 5; old and new builds side by side on the same database):

| Condition | Message in the conversation | Box empty | Sent copy confirmed |
| --- | --- | --- | --- |
| Unthrottled | 238 → 137 ms | 238 → 137 ms | 238 → 220 ms |
| Slow 4G + 4× CPU | 512 → 201 ms | 567 → 201 ms | 512 → 319 ms |

No frame without the message once it had appeared (0 ms gap in every run, before and after). Confirmation time depends on the server and Realtime, not on this change: an instrumented rerun recorded the Realtime event at 284–740 ms.

**Test:** `e2e/messages.spec.ts` holds the send back 1.5 s, then cuts it. It checks:
- the pending mark, the empty box, and a single sent copy;
- that text typed meanwhile is kept;
- after the cut: the message is gone, its text is back with the error, and nothing was stored.

## 11. AI streaming

Not applicable. The site has no AI features: no model calls, no generated text. Nothing to stream.

## 12. Benchmarks

The table below was measured before the two final adjustments described in item 6: the skeleton built on demand, and the venue cover's high priority. The routes those adjustments affect were measured again afterwards (item 6, and note 1).

**Conditions:** Slow 4G (150 ms, 1.6 Mbit/s down, 750 kbit/s up) and 4× CPU slowdown through the DevTools protocol, iPhone 13 profile, cold cache, a fresh browser context per load. Old (`main`) and new (this branch) builds ran side by side on the same database, **alternating load by load**, 5 loads each per route. The table gives medians. Differences under about 40 ms are within the run-to-run spread: the min–max ranges of the two builds overlap on every route except where noted.

| Route | TTFB old → new | FCP old → new | LCP old → new | CLS | Transferred | Requests |
| --- | --- | --- | --- | --- | --- | --- |
| Guest `/ar` | 35 → 29 ms | 1,076 → 1,060 ms | 1,364 → 1,344 ms | 0.090 → 0.090 | 674 → 678 KB | 30 → 31 |
| Guest `/ar/venues` | 21 → 24 | 1,000 → 980 | 1,552 → 1,536 | 0 → 0 | 448 → 448 | 27 → 26 |
| Guest `/ar/matches` | 22 → 21 | 1,056 → 1,032 | 1,552 → 1,584 ¹ | 0 → 0 | 451 → 452 | 26 → 26 |
| Guest `/ar/teams` | 19 → 22 | 1,016 → 1,012 | 1,556 → 1,556 | 0 → 0 | 451 → 452 | 28 → 28 |
| Guest venue page | 17 → 19 | 972 → 972 | 1,832 → 1,844 | 0 → 0 | 445 → 446 | 25 → 25 |
| Guest match page | 19 → 18 | 972 → 944 | 1,496 → 1,488 | 0 → 0 | 447 → 448 | 25 → 25 |
| Player dashboard | 62 → 60 | 1,004 → 960 | 1,496 → 1,516 | 0 → 0 | 449 → 450 | 30 → 30 |
| Player `/ar/matches` | 49 → 62 | 1,024 → 1,024 | 1,540 → 1,576 | 0 → 0 | 452 → 454 | 29 → 29 |
| **Player: create a match** | 57 → 64 | 1,016 → 1,052 ² | **3,224 → 2,540** | 0 → 0 | **525 → 497** | 28 → 28 |
| **Player: create a tournament** | 56 → 68 | 1,008 → 1,056 ² | **2,976 → 2,516** | 0 → 0 | **507 → 492** | 28 → 28 |
| Admin bookings | 79 → 91 | 1,056 → 1,036 | 2,032 → 2,072 | 0 → 0 | 467 → 469 | 37 → 38 |

1. The guest match list's LCP ranges barely separate (old 1,544–1,572 ms, new 1,576–1,612 ms). After the navigation skeleton stopped being sent with every page (item 6), a rerun gave medians of 1,560 ms (old) and 1,568 ms (new), with overlapping ranges (1,532–1,604 and 1,564–1,636).
2. On the two form pages first paint comes about 40–50 ms later, while the largest paint comes 460–684 ms earlier. The page is 15–28 KB smaller, so its content arrives sooner, and the first paint now includes it instead of showing the header alone.

**What these numbers do not include:**
- **The database changes.** Both builds ran against the same migrated database. Item 1 has their effect, measured with query plans.
- **The navigation and sending changes.** Items 9 and 10 have their own per-frame measurements.
- **Pictures.** The test database has none, so these routes load no photos. Item 6 measures pages with photos separately.

An earlier sequential run (all old loads, then all new loads) showed the new build 20–56 ms behind on three list pages. Running the builds alternately made that difference disappear: it came from drift over time, not from the code. That is why the table above alternates.

## Tests run (final build)

| Suite | Result |
| --- | --- |
| `pnpm typecheck` (route types + `tsc --noEmit`) | passed |
| ESLint on `src`, `e2e`, `tests`, `scripts` | passed |
| `pnpm i18n:check` | passed: 1,967 keys, Arabic and English in sync |
| Vitest, unit and database projects | 23 files, 201 tests passed |
| Playwright, desktop and mobile projects | 65 passed, 4 of them new |

The new tests:
- `e2e/organizer.spec.ts`: the venue list follows the chosen city, and the match is published with the other city's venue.
- `e2e/motion.spec.ts`: a quick navigation shows no skeleton and never an empty page; a page held back 2.5 s shows its skeleton only after one second.
- `e2e/messages.spec.ts`: a held-back send shows at once, keeps what was typed meanwhile and ends as a single sent copy; a cut-off send is taken back and stores nothing.

The first full Playwright run had four failures, and both causes were in how it was run:
- Three Telegram tests failed because the test runner was started without `.env.local`. They sign their webhook calls with `TELEGRAM_BOT_TOKEN`.
- The live-update test waited 15 s for a Realtime event just after the local containers had restarted.

With the environment loaded, all eight tests in those two files passed. The whole suite then passed twice, 65 of 65, the second time on the final build.

## Files changed

- **Database:** `supabase/migrations/20261106000026_read_performance.sql` (new; applied locally only).
- **Tie-breakers:** `src/server/venues/queries.ts`, `src/server/teams/queries.ts`, and the pages `notifications`, `my/bookings`, `recruitment`, `admin/bookings`, `admin/content`, `admin/audit`, `admin/venues`, `admin/reports`.
- **Venue lists in forms:**
  - `src/server/options.ts`, `src/server/options-actions.ts` (new), `src/components/forms/use-city-venues.ts` (new), `location-fields.tsx`, `match-form.tsx`, `tournament-form.tsx`;
  - the pages `matches/new`, `matches/[id]/edit`, `tournaments/new`, `tournaments/[id]/manage`, `teams/[id]/manage`, `opponents`.
- **Concurrent fetches:** the pages `venues/[id]`, `venues/[id]/book`, `manage/venues/[id]`, `teams/[id]/manage`, `notifications`.
- **Images and caching:**
  - `next.config.ts`, `src/lib/storage.ts`, `storage-image.tsx`, `venue-card.tsx`;
  - the pages `venues` and `venues/[id]`;
  - the upload calls in `src/server/messages.ts`, `profile.ts`, `teams/actions.ts`, `venues/actions.ts`;
  - `src/assets/landing/pitch-night.svg` (new) and `globals.css`.
- **Loading states:**
  - `src/app/[locale]/loading.tsx` (deleted), `layout.tsx`;
  - `page-skeleton.tsx` (new), `nav-progress.tsx`, `link-button.tsx`, `near-me.tsx`, `stage-host.tsx`, `enter-script.ts`, `globals.css`.
- **Optimistic messages:** `thread.tsx`, `composer.tsx`, `action-form.tsx` (`onError`), `field.tsx` (`Textarea` takes a ref), `messages/ar.json`, `messages/en.json`.
- **Tests:** `e2e/organizer.spec.ts`, `e2e/motion.spec.ts`, `e2e/messages.spec.ts`.
- **Docs:** this report, `CHANGES.md` (items 52–59), `DEPLOYMENT.md` (section 13), `DATABASE_DESIGN.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md`, `AUDIT.md`, `README.md`.

## The migration: approval needed

`supabase/migrations/20261106000026_read_performance.sql` has been applied to the **local** database only. It has **not** been run on production, and it should be run only with the owner's approval (SQL Editor in Supabase; steps in `DEPLOYMENT.md`, section 13).

- **Risk:** low. No data changes. Policies keep their conditions, and the equivalence was checked for every role. The search function keeps its signature and results. It is safe to run twice.
- **Locks:** the file runs as one transaction. Replacing a policy takes a brief exclusive lock on its table, and building an index blocks writes to its table, so requests to those tables wait until the file finishes. Run here the same way (role `postgres`, the whole file in one transaction, the four indexes built from scratch, rolled back), it took 583 ms the first time, with the data not yet in memory, and 45–48 ms on the next two runs. The longest index build was 134 ms (bookings, 20,725 rows).
- **For much larger tables:** create the four indexes first with `create index concurrently`, each statement on its own, then run the file.
- **Before it runs,** the app works as it does today, at today's speed. Nothing in the code depends on it.

## Risks that remain

- **Production was not measured.** The deployed site is outside this environment's network allowlist, and there is no access to Vercel or Supabase metrics. Real latency between Vercel and Supabase will make item 8 matter more than the local numbers show, and item 1 depends on production data sizes.
- **No physical device.** All phone numbers come from an emulated iPhone 13 with DevTools throttling.
- **The "find an opponent" form** still lists the venues of every city, capped at the API's first 1,000, as before. Its venue is optional, with a free-text place as the alternative, and the form has no city to narrow the list by. Scoping it would mean changing the form, so it was left as it was.
- **Lab LCP on pages with pictures depends on download order.** On a saturated link the order in which the pictures and scripts finish decides when the largest picture paints, and a few KB of difference in the scripts can move it. The venue page was measured at parity after its fixes. Future changes to the scripts could shift it either way.
- **Confirmation of a sent message** still depends on the server and Realtime. Item 10 changes what the sender sees meanwhile, not how long the server takes.
- **Skeleton timing on a first visit** counts from the first paint, not from the tap that opened the site, because the stand-in's one-second delay is a CSS animation.

## Skipped or not measurable

| Item | Why |
| --- | --- |
| 3, the twenty remaining `select("*")` reads | Single rows, reference tables or short lists; trimming risks dropping a used field for a few hundred bytes |
| 5, AVIF | Slower encoding and a second stored copy per picture, for about 20% smaller files; WebP is universal |
| 11, AI streaming | The site has no AI features |
| 12, physical low-end phone | None available in this environment |
| 12, deployed site and production metrics | Not reachable from this environment; no production numbers are given |
| Foreign-key indexes on every column | No measured query needed them, and each index costs every write |

