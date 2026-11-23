import "server-only";
import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json, Tables } from "@/lib/supabase/types";

export type City = Tables<"cities">;
export type Area = Tables<"areas">;

/**
 * Cities, areas and the public platform settings change only when an
 * administrator edits them, yet every page read them from the database. They
 * are kept on the server for an hour (unstable_cache, read as a visitor: only
 * what anyone may see), and dropped at once when an administrator saves a
 * change (revalidateReference, from src/server/admin.ts).
 */
const REFERENCE_TAG = "reference";

function guestClient() {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const cachedCities = unstable_cache(
  async (): Promise<City[]> => (await guestClient().from("cities").select("*").eq("is_active", true).order("sort_order")).data ?? [],
  ["reference-cities"],
  { revalidate: 3600, tags: [REFERENCE_TAG] },
);

const cachedAreas = unstable_cache(
  async (): Promise<Area[]> => (await guestClient().from("areas").select("*").eq("is_active", true).order("name_en")).data ?? [],
  ["reference-areas"],
  { revalidate: 3600, tags: [REFERENCE_TAG] },
);

const cachedPublicSettings = unstable_cache(
  async (): Promise<Record<string, Json>> => {
    const { data } = await guestClient().from("platform_settings").select("key, value").eq("is_public", true);
    return Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
  },
  ["reference-public-settings"],
  { revalidate: 3600, tags: [REFERENCE_TAG] },
);

/** After an administrator changes a city, an area or a setting: the next request reads them afresh. */
export function revalidateReference() {
  revalidateTag(REFERENCE_TAG, { expire: 0 });
}

/** A public platform setting as a number (the fallback when unset or not a number). */
export async function publicSettingNumber(key: string, fallback: number): Promise<number> {
  const n = Number((await getPublicSettings())[key]);
  return Number.isFinite(n) ? n : fallback;
}

const getPublicSettings = cache(() => cachedPublicSettings());

/** How often open pages check for news, in seconds (platform setting live.check_seconds, 15 to 300; 90 if unset). */
export const getLiveCheckSeconds = cache(async (): Promise<number> => {
  const n = await publicSettingNumber("live.check_seconds", 90);
  return Math.min(300, Math.max(15, Math.round(n)));
});

export const getCities = cache(() => cachedCities());

export const getAreas = cache(() => cachedAreas());

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
