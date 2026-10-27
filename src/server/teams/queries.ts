import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const TEAM_CARD_SELECT =
  "id, name, logo_path, description, visibility, join_policy, skill_level, preferred_format, city:cities(name_en, name_ar), area:areas(name_en, name_ar), members:team_members(count)" as const;

export interface TeamCardData {
  id: string;
  name: string;
  logo_path: string | null;
  description: string | null;
  visibility: "public" | "private";
  join_policy: "request" | "invite_only";
  skill_level: "beginner" | "intermediate" | "advanced" | null;
  preferred_format: string | null;
  city: { name_en: string; name_ar: string } | null;
  area: { name_en: string; name_ar: string } | null;
  members: { count: number }[];
}

export async function listTeams(opts: { q?: string; city?: string; area?: string; format?: string; skill?: string; page: number }) {
  const supabase = await createClient();
  const size = 18;
  let query = supabase
    .from("teams")
    .select(TEAM_CARD_SELECT)
    .eq("is_archived", false)
    .eq("is_hidden", false)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .range((opts.page - 1) * size, opts.page * size);
  if (opts.q) query = query.ilike("name", `%${opts.q.replace(/[%_\\]/g, "")}%`);
  if (opts.city) query = query.eq("city_id", opts.city);
  if (opts.area) query = query.eq("area_id", opts.area);
  if (opts.format) query = query.eq("preferred_format", opts.format as "5v5");
  if (opts.skill) query = query.eq("skill_level", opts.skill as "beginner");
  const { data } = await query;
  const rows = (data ?? []) as unknown as TeamCardData[];
  return { items: rows.slice(0, size), hasMore: rows.length > size };
}

export const getTeam = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("teams")
    .select("*, city:cities(id, name_en, name_ar, timezone), area:areas(name_en, name_ar), home_venue:venues(id, name)")
    .eq("id", id)
    .maybeSingle();
  return data;
});

export type TeamDetail = NonNullable<Awaited<ReturnType<typeof getTeam>>>;

export async function getTeamMembers(teamId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("user_id, role, position, joined_at, profile:profiles(id, display_name, avatar_path, skill_level)")
    .eq("team_id", teamId)
    .order("joined_at");
  const order = { captain: 0, manager: 1, player: 2 } as const;
  return (data ?? []).sort((a, b) => order[a.role] - order[b.role]);
}

export async function getTeamMatches(teamId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("matches")
    .select("id, title, starts_at, status, home_team_id, away_team_id, city:cities(timezone), result:match_results(home_score, away_score, status)")
    .or(`team_id.eq.${teamId},home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("starts_at", { ascending: false })
    .limit(30);
  return data ?? [];
}

export async function myTeams(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select(`role, team:teams(${TEAM_CARD_SELECT}, is_archived)`)
    .eq("user_id", userId);
  return (data ?? []).flatMap((r) => (r.team && !(r.team as { is_archived: boolean }).is_archived ? [{ role: r.role, team: r.team as unknown as TeamCardData }] : []));
}

/**
 * Team record from verified results only: team-vs-team matches whose result
 * was confirmed by the opposing team.
 */
export function teamRecord(teamId: string, matches: Awaited<ReturnType<typeof getTeamMatches>>) {
  let won = 0, drawn = 0, lost = 0;
  for (const m of matches) {
    const r = Array.isArray(m.result) ? m.result[0] : m.result;
    if (!r || r.status !== "confirmed" || !m.home_team_id || !m.away_team_id) continue;
    const mine = m.home_team_id === teamId ? r.home_score : r.away_score;
    const theirs = m.home_team_id === teamId ? r.away_score : r.home_score;
    if (mine > theirs) won++;
    else if (mine < theirs) lost++;
    else drawn++;
  }
  return { won, drawn, lost, played: won + drawn + lost };
}
