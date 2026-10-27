import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Venue + field options for selects (visible venues only). */
export async function venueOptions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("id, name, city_id, fields:venue_fields(id, name, is_active)")
    .order("name");
  return (data ?? []).map((v) => ({ id: v.id, name: v.name, city_id: v.city_id, fields: (v.fields ?? []).filter((f) => f.is_active) }));
}

/** Teams the user captains or manages. */
export async function managedTeams(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("role, team:teams(id, name, is_archived, city_id, preferred_format)")
    .eq("user_id", userId)
    .in("role", ["captain", "manager"]);
  return (data ?? []).flatMap((r) => (r.team && !r.team.is_archived ? [{ ...r.team, role: r.role }] : []));
}
