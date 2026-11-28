import texts from "./site-texts.json";
import { supabase } from "./supabase";

/** What a match card shows (the site's MATCH_CARD_SELECT, trimmed to what the phone shows). */
export const MATCH_CARD = "id, title, status, starts_at, format, total_players, reserved_spots, confirmed_count, waitlist_count, price_per_player, currency, join_policy, area:areas(name_ar), city:cities(name_ar), venue:venues(id, name)";

export interface MatchCard {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  format: string;
  total_players: number;
  reserved_spots: number;
  confirmed_count: number;
  waitlist_count: number;
  price_per_player: number;
  currency: string;
  join_policy: string;
  area: { name_ar: string } | null;
  city: { name_ar: string } | null;
  venue: { id: string; name: string } | null;
}

/** "5v5" → "5 × 5". */
export const formatLabel = (format: string) => format.replace("v", " × ");
/** The site's words for a match's state. */
export const STATUS = texts.matchStatus as Record<string, string>;

export const openSpots = (m: Pick<MatchCard, "total_players" | "reserved_spots" | "confirmed_count">) =>
  Math.max(0, m.total_players - m.reserved_spots - m.confirmed_count);

const PAGE = 20;

/** Upcoming matches the member may see (the site's search_matches; its rules apply). */
export async function searchMatches(page: number, query?: string): Promise<{ items: MatchCard[]; more: boolean }> {
  const { data, error } = await supabase()
    .rpc("search_matches", { p_sort: "time", p_include_full: true, p_limit: PAGE + 1, p_offset: page * PAGE, ...(query ? { p_query: query } : {}) })
    .select(MATCH_CARD);
  if (error) throw error;
  const rows = (data ?? []) as unknown as MatchCard[];
  return { items: rows.slice(0, PAGE), more: rows.length > PAGE };
}

/** The member's own coming matches (as a player). */
export async function myUpcomingMatches(userId: string): Promise<MatchCard[]> {
  const { data } = await supabase()
    .from("match_participants")
    .select(`match:matches(${MATCH_CARD})`)
    .eq("user_id", userId)
    .in("status", ["confirmed", "pending"])
    .limit(50);
  const now = Date.now();
  return ((data ?? []) as unknown as { match: MatchCard | null }[])
    .flatMap((r) => (r.match && Date.parse(r.match.starts_at) > now - 2 * 3600_000 && r.match.status !== "cancelled" ? [r.match] : []))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, 10);
}
