import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/types";

/**
 * The profile columns visitors and members may read: everything but the
 * suspension reason and time, which stay with the moderators (migration 0032
 * grants exactly these). `select("*")` on profiles is refused for that reason.
 */
export const PROFILE_COLUMNS =
  "id, display_name, avatar_path, bio, city_id, area_id, positions, skill_level, preferred_formats, show_match_history, status, onboarded_at, created_at, updated_at";

/** The same, with the username (migration 0041). */
const PROFILE_COLUMNS_WITH_USERNAME = `${PROFILE_COLUMNS}, username` as const;

/** A profile as the site reads it. The username is null only before migration 0041 has run. */
export type Profile = Omit<Tables<"profiles">, "suspension_reason" | "suspended_at" | "username"> & { username: string | null };

/**
 * A profile by id, with its username. Before migration 0041 adds that column,
 * asking for it fails (42703, no such column): the profile is then read
 * without it, so every page keeps working until the SQL is run.
 */
export async function selectProfile(supabase: SupabaseClient<Database>, id: string): Promise<Profile | null> {
  const withName = await supabase.from("profiles").select(PROFILE_COLUMNS_WITH_USERNAME).eq("id", id).maybeSingle();
  if (!withName.error) return withName.data;
  if (withName.error.code !== "42703") return null;
  const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
  return data ? { ...data, username: null } : null;
}
