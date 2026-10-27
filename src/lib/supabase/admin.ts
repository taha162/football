import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Service-role client. Bypasses RLS — use only for operations that have no
 * user-scoped equivalent (auth bans, scheduled jobs) and only after the caller
 * has been authorized. Never import from client components.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publicEnv.supabaseUrl || !key) return null;
  return createClient<Database>(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
