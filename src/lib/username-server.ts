import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { isValidUsername, normalizeUsername, type UsernameStatus } from "@/lib/username";

/** A username from a form, as stored, checked against the rules. */
export const usernameField = z.string().transform(normalizeUsername).refine(isValidUsername, "invalid_username");

/**
 * Whether a username is free, as the database says. «unknown» before migration
 * 0041 (no such function yet): sign-up then goes ahead, and the database
 * ignores the username until the update.
 */
export async function usernameFree(supabase: SupabaseClient<Database>, name: string): Promise<UsernameStatus> {
  const { data, error } = await supabase.rpc("username_available", { p_username: name });
  if (error) return "unknown";
  return data === "ok" || data === "taken" || data === "invalid" ? data : "unknown";
}
