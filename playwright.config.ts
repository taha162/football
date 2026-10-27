import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a running app + local Supabase stack:
 *   pnpm db:start && pnpm build && pnpm e2e
 * (or reuse a running `pnpm dev` server). Each test creates its own users and
 * data, so tests can run in parallel and against a non-empty database.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-GB",
    timezoneId: "Asia/Baghdad",
  },
  webServer: {
    command: process.env.E2E_SERVER_COMMAND ?? "pnpm start",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec/ },
  ],
});
