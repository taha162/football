import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { VenueOption } from "@/components/match/match-form";

/** The API returns at most this many rows per request. */
const PAGE = 1000;

/**
 * A city's visible venues with their active courts, by name, for forms where
 * the venue must be in the chosen city (a match or a tournament: the database
 * refuses any other). Read a page at a time in a fixed order (name, then id),
 * so a large city is never cut at the API's row limit.
 */
export async function venueOptions(cityId: string | null | undefined): Promise<VenueOption[]> {
  if (!cityId) return [];
  const supabase = await createClient();
  const rows: VenueOption[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("venues")
      .select("id, name, city_id, fields:venue_fields(id, name, is_active)")
      .eq("city_id", cityId)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    for (const v of data ?? []) rows.push({ id: v.id, name: v.name, city_id: v.city_id, fields: (v.fields ?? []).filter((f) => f.is_active) });
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * Venue names only (id, name): a team's home venue (its city's venues), or a
 * challenge's venue (every city, as before: like before, the API returns at
 * most 1,000 of them).
 */
export async function venueNames(cityId?: string | null): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  let query = supabase.from("venues").select("id, name").order("name").order("id");
  if (cityId) query = query.eq("city_id", cityId);
  const { data } = await query;
  return data ?? [];
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
