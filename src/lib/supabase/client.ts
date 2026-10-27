"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Browser client (anon key + user session). Used for realtime subscriptions. */
export function getBrowserClient() {
  client ??= createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return client;
}
