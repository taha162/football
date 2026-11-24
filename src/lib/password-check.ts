import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Whether `password` is the account's: a throwaway sign-in, on a client that
 * keeps no session and touches no cookie, signed out again at once (only that
 * sign-in, not the member's own). Changing the e-mail or the number asks for
 * it, so a stolen session alone can't take the account over.
 */
export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const probe = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}
