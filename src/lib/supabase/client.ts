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

/**
 * The browser client, with its live connection signed in as the current user.
 * Live updates are filtered by RLS on the server, which needs the user's
 * token: a channel that joins before the session has loaded joins as a guest
 * and receives nothing. Await this before subscribing.
 */
export async function getRealtimeClient() {
  const supabase = getBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
  return supabase;
}
