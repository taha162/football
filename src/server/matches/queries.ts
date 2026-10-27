import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/supabase/types";

export const MATCH_CARD_SELECT =
  "id, title, status, starts_at, ends_at, format, match_type, total_players, reserved_spots, confirmed_count, waitlist_count, pending_count, price_per_player, currency, cost_is_estimate, skill_level, join_policy, visibility, booking_status, positions_needed, city:cities(timezone, name_en, name_ar), area:areas(name_en, name_ar), venue:venues(id, name, latitude, longitude), home_team:teams!matches_home_team_id_fkey(id, name), away_team:teams!matches_away_team_id_fkey(id, name)" as const;

export interface MatchCardData {
  id: string;
  title: string;
  status: Database["public"]["Enums"]["match_status"];
  starts_at: string;
  ends_at: string;
  format: Database["public"]["Enums"]["match_format"];
  match_type: Database["public"]["Enums"]["match_type"];
  total_players: number;
  reserved_spots: number;
  confirmed_count: number;
  waitlist_count: number;
  pending_count: number;
  price_per_player: number;
  currency: string;
  cost_is_estimate: boolean;
  skill_level: Database["public"]["Enums"]["skill_level"] | null;
  join_policy: Database["public"]["Enums"]["match_join_policy"];
  visibility: Database["public"]["Enums"]["visibility_level"];
  booking_status: Database["public"]["Enums"]["match_booking_status"];
  positions_needed: Record<string, number>;
  city: { timezone: string; name_en: string; name_ar: string } | null;
  area: { name_en: string; name_ar: string } | null;
  venue: { id: string; name: string; latitude: number | null; longitude: number | null } | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
}

export type MatchSort = "time" | "relevance" | "distance";

export interface MatchSearch {
  city?: string;
  area?: string;
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  format?: Database["public"]["Enums"]["match_format"];
  skill?: Database["public"]["Enums"]["skill_level"];
  maxPrice?: number;
  position?: Database["public"]["Enums"]["player_position"];
  minSlots?: number;
  bookingConfirmed?: boolean;
  joinPolicy?: Database["public"]["Enums"]["match_join_policy"];
  includeFull?: boolean;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: MatchSort;
  page?: number;
  query?: string;
}

export const PAGE_SIZE = 12;

/** Server-side filtered discovery (RLS applies via SECURITY INVOKER). */
export async function searchMatches(s: MatchSearch): Promise<{ items: MatchCardData[]; hasMore: boolean }> {
  const supabase = await createClient();
  const page = Math.max(1, s.page ?? 1);
  const { data, error } = await supabase
    .rpc("search_matches", {
      p_city_id: s.city,
      p_area_id: s.area,
      p_date_from: s.dateFrom,
      p_date_to: s.dateTo,
      p_time_from: s.timeFrom,
      p_time_to: s.timeTo,
      p_format: s.format,
      p_skill_level: s.skill,
      p_max_price: s.maxPrice,
      p_position: s.position,
      p_min_open_slots: s.minSlots,
      p_booking_confirmed: s.bookingConfirmed,
      p_join_policy: s.joinPolicy,
      p_include_full: s.includeFull ?? true,
      p_lat: s.lat,
      p_lng: s.lng,
      p_radius_km: s.radiusKm,
      p_sort: s.sort ?? "time",
      p_limit: PAGE_SIZE + 1,
      p_offset: (page - 1) * PAGE_SIZE,
      p_query: s.query,
    })
    .select(MATCH_CARD_SELECT);
  if (error) throw error;
  const rows = (data ?? []) as unknown as MatchCardData[];
  return { items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export const getMatch = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("matches")
    .select(
      `*, city:cities(id, timezone, name_en, name_ar, currency), area:areas(name_en, name_ar), venue:venues(id, name, address, latitude, longitude, phone, booking_mode, verification_status), field:venue_fields(id, name), organizer:profiles!matches_organizer_id_fkey(id, display_name, avatar_path), team:teams!matches_team_id_fkey(id, name), home_team:teams!matches_home_team_id_fkey(id, name), away_team:teams!matches_away_team_id_fkey(id, name), result:match_results(*)`,
    )
    .eq("id", id)
    .maybeSingle();
  return data;
});

export type MatchDetail = NonNullable<Awaited<ReturnType<typeof getMatch>>>;

export async function getRoster(matchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("match_participants")
    .select("*, profile:profiles!match_participants_user_id_fkey(id, display_name, avatar_path, positions, skill_level)")
    .eq("match_id", matchId)
    .in("status", ["confirmed", "pending"])
    .order("joined_at");
  return data ?? [];
}

export async function getWaitlist(matchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("match_waitlist")
    .select("*, profile:profiles!match_waitlist_user_id_fkey(id, display_name, avatar_path)")
    .eq("match_id", matchId)
    .eq("status", "waiting")
    .order("seq");
  return data ?? [];
}

export async function getMatchInvitations(matchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("match_invitations")
    .select("*, invitee:profiles!match_invitations_invitee_id_fkey(id, display_name, avatar_path)")
    .eq("match_id", matchId)
    .eq("status", "pending");
  return data ?? [];
}

export async function getMatchEvents(matchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("match_events")
    .select("*, profile:profiles!match_events_user_id_fkey(id, display_name)")
    .eq("match_id", matchId)
    .order("minute", { nullsFirst: false });
  return data ?? [];
}

/** The caller's own relationship to a match (participant / waitlist / invitation). */
export async function getMyMatchState(matchId: string, userId: string) {
  const supabase = await createClient();
  const [p, w, i] = await Promise.all([
    supabase.from("match_participants").select("*").eq("match_id", matchId).eq("user_id", userId).in("status", ["confirmed", "pending"]).maybeSingle(),
    supabase.from("match_waitlist").select("id, seq").eq("match_id", matchId).eq("user_id", userId).eq("status", "waiting").maybeSingle(),
    supabase.from("match_invitations").select("id").eq("match_id", matchId).eq("invitee_id", userId).eq("status", "pending").maybeSingle(),
  ]);
  let waitlistPosition: number | null = null;
  if (w.data) {
    const { count } = await supabase
      .from("match_waitlist")
      .select("id", { count: "exact", head: true })
      .eq("match_id", matchId)
      .eq("status", "waiting")
      .lte("seq", w.data.seq);
    waitlistPosition = count ?? null;
  }
  return { participant: p.data as Tables<"match_participants"> | null, waitlistId: w.data?.id ?? null, waitlistPosition, invitationId: i.data?.id ?? null };
}

/** Matches the user organizes or participates in. */
export async function getMyMatches(userId: string, scope: "upcoming" | "past") {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [{ data: organized }, { data: joined }, { data: waiting }] = await Promise.all([
    supabase.from("matches").select(MATCH_CARD_SELECT).eq("organizer_id", userId),
    supabase.from("match_participants").select(`status, match:matches(${MATCH_CARD_SELECT})`).eq("user_id", userId).in("status", ["confirmed", "pending"]),
    supabase.from("match_waitlist").select(`match:matches(${MATCH_CARD_SELECT})`).eq("user_id", userId).eq("status", "waiting"),
  ]);
  const map = new Map<string, MatchCardData & { role: "organizer" | "participant" | "pending" | "waitlisted" }>();
  for (const m of (organized ?? []) as unknown as MatchCardData[]) map.set(m.id, { ...m, role: "organizer" });
  for (const row of (joined ?? []) as unknown as { status: string; match: MatchCardData | null }[]) {
    if (row.match && !map.has(row.match.id)) map.set(row.match.id, { ...row.match, role: row.status === "pending" ? "pending" : "participant" });
  }
  for (const row of (waiting ?? []) as unknown as { match: MatchCardData | null }[]) {
    if (row.match && !map.has(row.match.id)) map.set(row.match.id, { ...row.match, role: "waitlisted" });
  }
  const all = [...map.values()];
  const isPast = (m: MatchCardData) => m.status === "completed" || m.status === "cancelled" || m.ends_at < nowIso;
  return all
    .filter((m) => (scope === "past" ? isPast(m) : !isPast(m)))
    .sort((a, b) => (scope === "past" ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at)));
}
