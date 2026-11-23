import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";

export type City = Tables<"cities">;
export type Area = Tables<"areas">;

/** How often open pages check for news, in seconds (platform setting live.check_seconds, 15 to 300; 90 if unset). */
export const getLiveCheckSeconds = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("value").eq("key", "live.check_seconds").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) ? Math.min(300, Math.max(15, Math.round(n))) : 90;
});

export const getCities = cache(async (): Promise<City[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("cities").select("*").eq("is_active", true).order("sort_order");
  return data ?? [];
});

export const getAreas = cache(async (): Promise<Area[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("areas").select("*").eq("is_active", true).order("name_en");
  return data ?? [];
});

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

/** Whether the user staffs a venue or organizes a tournament (for the account menu). */
export const getManagedThings = cache(async (userId: string): Promise<{ venues: boolean; tournaments: boolean }> => {
  const supabase = await createClient();
  const [venues, tournaments] = await Promise.all([
    supabase.from("venue_staff").select("venue_id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("tournaments").select("id", { count: "exact", head: true }).eq("organizer_id", userId),
  ]);
  return { venues: (venues.count ?? 0) > 0, tournaments: (tournaments.count ?? 0) > 0 };
});

/**
 * Unread messages (from the conversations themselves) and unread notifications.
 * A message is never news for the bell: it shows as a red dot on the messages
 * button instead, so the bell counts every other kind of notification only.
 * (Message notifications are still written: their arrival is what refreshes an
 * open page live, components/layout/live-refresh.tsx.)
 */
export const getUnreadCounts = cache(async (): Promise<{ notifications: number; messages: number }> => {
  const supabase = await createClient();
  const [{ data }, bell] = await Promise.all([
    supabase.rpc("unread_counts"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).neq("type", "new_message"),
  ]);
  const v = (data ?? {}) as { notifications?: number; messages?: number };
  return { notifications: bell.error ? Number(v.notifications ?? 0) : (bell.count ?? 0), messages: Number(v.messages ?? 0) };
});
