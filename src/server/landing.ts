import "server-only";
import { POSITIONS, type Position } from "@/lib/domain/match";
import { createClient } from "@/lib/supabase/server";

/**
 * Teams with an open recruitment post for each position (a post that lists no
 * positions accepts any). Counts what the /recruitment page shows: open,
 * unexpired posts of teams the visitor can see. Null when the query fails,
 * so the page shows no figure rather than a wrong one.
 */
export async function teamsRecruitingByPosition(): Promise<Record<Position, number> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_recruitment")
    .select("positions, team:teams(id)")
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .limit(1000);
  if (error) return null;
  const teams = Object.fromEntries(POSITIONS.map((p) => [p, new Set<string>()])) as Record<Position, Set<string>>;
  for (const row of data ?? []) {
    if (!row.team) continue;
    for (const p of POSITIONS) if (row.positions.length === 0 || row.positions.includes(p)) teams[p].add(row.team.id);
  }
  return Object.fromEntries(POSITIONS.map((p) => [p, teams[p].size])) as Record<Position, number>;
}

/** Tournaments open for registration or under way, soonest first (as on /tournaments). */
export async function currentTournaments(limit: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name, status, starts_on, ends_on, format, team_capacity, registration_deadline, city:cities(name_en, name_ar, timezone), teams:tournament_teams(status)")
    .in("status", ["registration_open", "registration_closed", "in_progress"])
    .order("starts_on")
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
