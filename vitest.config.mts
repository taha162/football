import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          // Integration tests against a real Supabase Postgres (see README:
          // `pnpm db:start`). They exercise RLS, RPCs and concurrency.
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // Files run in parallel; each creates its own uniquely named data.
          maxWorkers: 4,
        },
      },
    ],
  },
});
