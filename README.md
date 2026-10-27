# Malaab · ملعب

A community platform for recreational football: find and organize matches, build teams, find opponents, book pitches, run tournaments, and keep the community safe. The first market is **Mosul** (Asia/Baghdad, Iraqi dinar). Other cities can be added in the admin area. The interface is fully bilingual: **Arabic (RTL, default)** and **English (LTR)**.

| Document | Contents |
| --- | --- |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Phases, scope decisions, what comes next |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Functional and non-functional requirements and business rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, layers, data flow, key decisions and trade-offs |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | Schema, constraints, concurrency, RLS, RPCs, jobs |
| [SECURITY.md](SECURITY.md) | Threat model, controls, secrets, operator procedures |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | What is done, verified, and not yet built |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Step-by-step Vercel + Supabase deployment (Arabic) |

## Stack

- Next.js 16 (App Router, Turbopack, `proxy.ts`), React 19, TypeScript strict, Tailwind CSS 4
- Supabase: Postgres, Auth, Storage, Realtime. Schema lives in `supabase/migrations`.
- next-intl (ar/en), Zod, Vitest (unit + real-Postgres integration), Playwright (E2E, desktop + mobile)

## Local development

Prerequisites: Node 20+, pnpm 10, Docker (for the local Supabase stack).

```bash
pnpm install
pnpm db:start                  # starts local Supabase and applies all migrations
npx supabase status -o env     # prints the local URL / anon key / service role key
cp .env.example .env.local     # then paste the values (and set CRON_SECRET)
pnpm dev                       # http://localhost:3000  (redirects to /ar)
```

`pnpm db:start` pulls images from Docker Hub by default (`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`). Override that variable to use another registry.

The local stack has e-mail confirmation turned off, so sign-up leads straight to onboarding. Outgoing auth e-mails (such as password resets) are captured by the local mail catcher at http://127.0.0.1:54324.

### First administrator

Nobody can promote themselves. To bootstrap the first admin, an operator with the service-role key runs the following after the person has signed up:

```bash
set -a; . ./.env.local; set +a
pnpm admin:grant person@example.com admin      # or: moderator
```

The grant is written to the audit log. From then on, admins manage roles at `/admin/users`.

### Scheduled jobs

`GET /api/cron` with `Authorization: Bearer $CRON_SECRET` runs `run_scheduled_jobs()`. That job expires undecided booking requests, sends match reminders, closes expired listings, auto-completes past matches and closes tournament registration at the deadline. It is idempotent, so call it every ~15 minutes from any scheduler, such as Vercel Cron, GitHub Actions or a system cron.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server / production build / production server |
| `pnpm lint` | ESLint (incl. React Compiler rules) |
| `pnpm typecheck` | Generates route types (`next typegen`) and runs `tsc --noEmit` |
| `pnpm i18n:check` | Verifies ar/en key parity and that every static translation key used in code exists |
| `pnpm test` | All Vitest projects |
| `pnpm test:unit` | Pure domain tests (money, status machine, tournament generators, standings) |
| `pnpm test:db` | Integration tests against the local Postgres: RLS, RPC rules, concurrency |
| `pnpm e2e` | Playwright journeys (needs the app running or builds/starts it; needs the local stack) |
| `pnpm db:start` / `db:stop` / `db:reset` | Local Supabase lifecycle (`db:reset` re-applies migrations and **wipes local data**) |
| `pnpm db:types` | Regenerates `src/lib/supabase/types.ts` from the local schema |
| `pnpm admin:grant` | Operator-only role bootstrap (see above) |

### Running the full verification locally

```bash
pnpm db:start
pnpm lint && pnpm typecheck && pnpm i18n:check
set -a; . ./.env.local; set +a
pnpm test
pnpm build && pnpm e2e        # Playwright starts `pnpm start` if nothing is listening on :3000
```

Each E2E test and DB test creates its own uniquely named users and data. They can therefore run in parallel and against a database that already contains data. They never delete data.

## Deployment (Vercel + Supabase)

The repository is ready for Vercel. See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full guide. In short:

1. Create a Supabase project (Frankfurt). Apply migrations with `npx supabase db push` or the manual **Deploy database migrations** workflow.
2. Configure Supabase Auth:
   - Site URL and redirect URLs (`/auth/callback`).
   - E-mail confirmation on.
   - Custom SMTP.
3. Import the repo in Vercel. `vercel.json` sets pnpm, the `fra1` region and a daily cron. Add the variables from `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are server-only, Production only.
4. For 15-minute scheduled jobs on the Hobby plan, add `APP_URL` and `CRON_SECRET` as GitHub secrets for the **Scheduled jobs** workflow. On Pro, set the cron in `vercel.json` to `*/15 * * * *` instead.
5. Grant the first admin with `pnpm admin:grant`.

No payment provider, SMS, push or map provider is configured. The app does not pretend otherwise; see IMPLEMENTATION_STATUS.md.
