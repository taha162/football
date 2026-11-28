import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * The phone app (native/) sends its session as `Authorization: Bearer <access
 * token>`, not cookies. This makes a client that acts as that member (RLS and
 * the database's checks apply as on the site), after Supabase confirms the
 * token. It keeps nothing.
 */
export async function appMember(request: NextRequest): Promise<{ supabase: SupabaseClient<Database>; user: User } | null> {
  const token = /^Bearer (\S{20,4096})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const supabase = createSupabaseClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : { supabase, user: data.user };
}

/** A client for one sign-in, whose session goes back to the app: nothing is stored here. */
export function appSignInClient(): SupabaseClient<Database> {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
