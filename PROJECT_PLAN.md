# Project plan

## Goal

A production-oriented football community platform for Mosul that can expand to other cities. It covers matchmaking, teams, opponents, venues and bookings, tournaments, communication, and trust and safety, in Arabic and English.

## Guiding decisions

1. **Correctness before polish.** Business rules and concurrency live in Postgres and are tested against a real database before any UI is built on them.
2. **Honest product.** No payments, maps, SMS or push are faked. Each is either implemented against a real provider or clearly absent.
3. **One codebase, two languages.** Arabic is the default. RTL is designed in from the start (logical CSS properties, locale-prefixed URLs), not retrofitted.
4. **Small, verifiable phases.** Each phase ends with lint, typecheck and tests green.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0. Foundation | Next.js 16 + TS strict + Tailwind, Supabase CLI stack, migration workflow, env handling | Done |
| 1. Data model and rules | Schema, RLS, RPCs, status machines, concurrency controls, reference data | Done |
| 2. DB integration tests | Capacity races, waitlist order, double booking, RLS and privilege checks, jobs | Done (64 tests) |
| 3. App foundation | i18n (ar/en), auth flows, proxy, design system, layout, error/loading states | Done |
| 4. Features | Matches, teams, opponents, venues and bookings, tournaments, messaging, notifications, results, reviews, reports, admin | Done (see IMPLEMENTATION_STATUS.md) |
| 5. Quality | Unit tests, E2E journeys A–K plus mobile RTL, production build, docs | Done (local) |
| 6. Launch readiness | CI, staging deploy, SMTP, scheduler, legal review, support channel, area verification, first admin | **Next** |
| 7. Post-launch | E-mail notifications, account deletion/export, maps with a real token, knockout E2E, analytics | Planned |

## E2E journeys

| Journey | Covered by |
| --- | --- |
| A. Register, onboard, discover, join | `e2e/players.spec.ts` |
| B. Organizer creates a match with cost sharing, manages the roster | `e2e/organizer.spec.ts` |
| C. Waiting-list promotion | `e2e/players.spec.ts` |
| D. Team creation, invitation, recruitment | `e2e/teams.spec.ts` |
| E. Opponent request → challenge → team-vs-team match | `e2e/teams.spec.ts` |
| F. Venue onboarding → verification → booking → confirmation | `e2e/venues.spec.ts` |
| G. Overlapping booking requests | `e2e/venues.spec.ts` |
| H. Tournament registration → fixtures → results → standings | `e2e/tournaments.spec.ts` |
| I. Report → moderation (hide content, remove message) | `e2e/admin.spec.ts` |
| J. Arabic/English switching and RTL | `e2e/players.spec.ts` |
| K. Unauthorized access | `e2e/players.spec.ts`, `e2e/admin.spec.ts` |
| Mobile (Arabic, RTL) | `e2e/mobile.spec.ts` |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Race conditions on popular matches and slots | Row locks, exclusion constraint, advisory locks; parallel DB tests |
| Abuse and spam | Rate limits, reports with snapshots, hide/remove/suspend, audit log |
| Fake venues | Verification gate before in-app bookings |
| Payment disputes | Payments are explicitly outside the app; organizers only mark them manually |
| Legal exposure | Legal pages flagged for lawyer review before launch |
| Local accuracy (areas, naming) | Area list flagged for local verification; cities and areas editable by admins |

## Out of scope (for now)

- Online payments, deposits and refunds.
- Native mobile apps. The web app is mobile-first.
- Phone/OTP and social sign-in.
- Push, SMS and e-mail notifications (preferences are already stored).
