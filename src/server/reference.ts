import "server-only";
import { cache } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json, Tables } from "@/lib/supabase/types";

export type City = Tables<"cities">;
export type Area = Tables<"areas">;

/**
 * Cities, areas and the public platform settings: read once per request
 * (React cache), as a visitor (only what anyone may see), and never kept
 * between requests, so a change shows on the next page however it is made:
 * in the admin panel, with SQL, or by a migration. Each table holds a few
 * dozen rows. (They were kept for an hour at first; the owner wanted changes
 * made with SQL to show at once, CHANGES.md item 112.)
 */
const makeGuestClient = () =>
  createSupabaseClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
let guest: ReturnType<typeof makeGuestClient> | undefined;

/** One client for these public reads, shared by every request: it carries no session. */
function guestClient() {
  return (guest ??= makeGuestClient());
}

const getPublicSettings = cache(async (): Promise<Record<string, Json>> => {
  const { data } = await guestClient().from("platform_settings").select("key, value").eq("is_public", true);
  return Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
});

/** A public platform setting as a number (the fallback when unset or not a number). */
export async function publicSettingNumber(key: string, fallback: number): Promise<number> {
  const n = Number((await getPublicSettings())[key]);
  return Number.isFinite(n) ? n : fallback;
}

/** How often open pages check for news, in seconds (platform setting live.check_seconds, 15 to 300; 90 if unset). */
export const getLiveCheckSeconds = cache(async (): Promise<number> => {
  const n = await publicSettingNumber("live.check_seconds", 90);
  return Math.min(300, Math.max(15, Math.round(n)));
});

export const getCities = cache(
  async (): Promise<City[]> => (await guestClient().from("cities").select("*").eq("is_active", true).order("sort_order")).data ?? [],
);

export const getAreas = cache(
  async (): Promise<Area[]> => (await guestClient().from("areas").select("*").eq("is_active", true).order("name_en")).data ?? [],
);

export async function areaById(id: string | null | undefined): Promise<Area | undefined> {
  if (!id) return undefined;
  return (await getAreas()).find((a) => a.id === id);
}

export function localizedName(row: { name_en: string; name_ar: string } | null | undefined, locale: string): string {
  if (!row) return "";
  return locale === "ar" ? row.name_ar : row.name_en;
}

export async function cityById(id: string | null | undefined): Promise<City | undefined> {
  if (!id) return undefined;
  return (await getCities()).find((c) => c.id === id);
}

export async function defaultCity(): Promise<City | undefined> {
  return (await getCities())[0];
}

type HeaderState = { notifications: number; messages: number; venues: boolean; tournaments: boolean };

/**
 * What the header needs on every page, in one request (header_state(),
 * migration 0035): unread messages, unread notifications, and whether the
 * member staffs a venue or organizes a tournament (the account menu). Counts
 * stop at 100.
 *
 * A message is never news for the bell: it shows as a red dot on the messages
 * button instead, so the bell counts every other kind of notification only.
 * (Message notifications are still written: their arrival is what refreshes an
 * open page live, components/layout/live-refresh.tsx.)
 *
 * Before 0035 runs, the four separate requests it replaces.
 */
const getHeaderState = cache(async (userId: string): Promise<HeaderState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("header_state");
  if (!error && data && typeof data === "object") {
    const v = data as { notifications?: number; messages?: number; manages_venues?: boolean; manages_tournaments?: boolean };
    return { notifications: Number(v.notifications ?? 0), messages: Number(v.messages ?? 0), venues: Boolean(v.manages_venues), tournaments: Boolean(v.manages_tournaments) };
  }
  const [{ data: counts }, bell, venues, tournaments] = await Promise.all([
    supabase.rpc("unread_counts"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).neq("type", "new_message"),
    supabase.from("venue_staff").select("venue_id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("tournaments").select("id", { count: "exact", head: true }).eq("organizer_id", userId),
  ]);
  const v = (counts ?? {}) as { notifications?: number; messages?: number };
  return {
    notifications: bell.error ? Number(v.notifications ?? 0) : (bell.count ?? 0),
    messages: Number(v.messages ?? 0),
    venues: (venues.count ?? 0) > 0,
    tournaments: (tournaments.count ?? 0) > 0,
  };
});

/** Whether the user staffs a venue or organizes a tournament (for the account menu). */
export async function getManagedThings(userId: string): Promise<{ venues: boolean; tournaments: boolean }> {
  const { venues, tournaments } = await getHeaderState(userId);
  return { venues, tournaments };
}

/** Unread messages and unread notifications (the bell's: no new-message ones), each counted up to 100 (shown «99+»). */
export async function getUnreadCounts(userId: string): Promise<{ notifications: number; messages: number }> {
  const { notifications, messages } = await getHeaderState(userId);
  return { notifications, messages };
}
