"use client";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * The session cookies are HttpOnly (src/lib/env.ts): no script in the page
 * can read them. The browser client asks the site for the access token
 * instead (/api/session) and keeps it until a minute before it expires. Only
 * that token, good for an hour at most, ever reaches the page; the refresh
 * token that keeps a session going stays in the cookies.
 */
type Held = { token: string | null; user: string | null; until: number };
let held: Held | null = null;
let asking: Promise<Held> | null = null;
/** The person the page was rendered for (undefined until a component says): a token for anyone else is asked for again. */
let expectedUser: string | null | undefined;

async function ask(): Promise<Held> {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_at?: unknown; user_id?: unknown };
    const token = res.ok && typeof body.access_token === "string" ? body.access_token : null;
    const expires = typeof body.expires_at === "number" ? body.expires_at * 1000 : 0;
    return {
      token,
      user: token && typeof body.user_id === "string" ? body.user_id : null,
      // Asked again a minute before it expires; without a session, again after a minute.
      until: token && expires ? Math.max(Date.now() + 30_000, expires - 60_000) : Date.now() + 60_000,
    };
  } catch {
    // Offline for a moment: asked again on the next request.
    return { token: null, user: null, until: 0 };
  }
}

/** The signed-in person's access token, or null. */
export async function getAccessToken(): Promise<string | null> {
  if (held && Date.now() < held.until && (expectedUser === undefined || held.user === expectedUser)) return held.token;
  asking ??= ask()
    .then((h) => (held = h))
    .finally(() => {
      asking = null;
    });
  return (await asking).token;
}

/** Who the page is for: after signing in, out, or into another account, the held token is dropped. */
export function expectSessionUser(userId: string | null) {
  if (expectedUser === userId) return;
  expectedUser = userId;
  held = null;
}

let client: ReturnType<typeof createClient<Database>> | null = null;

/** Browser client: the anon key plus the person's access token from /api/session. Used for live updates and calls. */
export function getBrowserClient() {
  client ??= createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { accessToken: getAccessToken });
  return client;
}

/**
 * The browser client, with its live connection signed in as the current user.
 * Live updates are filtered by RLS on the server, which needs the user's
 * token: a channel that joins before the token is in joins as a guest and
 * receives nothing. Await this before subscribing. `userId`: the person the
 * page was rendered for, so a token held for someone else isn't used.
 */
export async function getRealtimeClient(userId?: string | null) {
  if (userId !== undefined) expectSessionUser(userId);
  const supabase = getBrowserClient();
  const token = await getAccessToken();
  if (token) await supabase.realtime.setAuth(token);
  return supabase;
}
