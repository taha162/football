import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getTournament = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournaments")
    .select("*, city:cities(id, name_en, name_ar, timezone), venue:venues(id, name), organizer:profiles!tournaments_organizer_id_fkey(id, display_name)")
    .eq("id", id)
    .maybeSingle();
  return data;
});

export type TournamentDetail = NonNullable<Awaited<ReturnType<typeof getTournament>>>;

export async function getTournamentTeams(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournament_teams")
    .select("*, team:teams(id, name, logo_path)")
    .eq("tournament_id", id)
    .order("created_at");
  return data ?? [];
}

export async function getFixtures(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("tournament_matches").select("*").eq("tournament_id", id).order("stage").order("round").order("match_number");
  return data ?? [];
}

export async function getAnnouncements(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("tournament_announcements").select("*").eq("tournament_id", id).order("created_at", { ascending: false }).limit(20);
  return data ?? [];
}
