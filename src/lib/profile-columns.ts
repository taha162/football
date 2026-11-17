import type { Tables } from "@/lib/supabase/types";

/**
 * The profile columns visitors and members may read: everything but the
 * suspension reason and time, which stay with the moderators (migration 0032
 * grants exactly these). `select("*")` on profiles is refused for that reason.
 */
export const PROFILE_COLUMNS =
  "id, display_name, avatar_path, bio, city_id, area_id, positions, skill_level, preferred_formats, show_match_history, status, onboarded_at, created_at, updated_at";

export type Profile = Omit<Tables<"profiles">, "suspension_reason" | "suspended_at">;
