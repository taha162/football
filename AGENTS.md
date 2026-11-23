<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Performance profile
- Tier: L  (decided 2026-11-20)
- Expected users (6 months): more than 50,000
- Biggest growing tables: messages, notifications, bookings (over 5 million rows a year)
- Freshness needs: chat and calls instantly (Realtime); other pages within about 90 s (live.check_seconds)
- Images: venue covers and galleries, avatars, team logos (next/image, WebP); chat pictures with a small copy made in the browser
- Infra budget: whatever it needs (ask before adding a paid service)
- Always use the `speed-engineer` skill when touching DB queries/schema, lists, data fetching, images or loading states.
