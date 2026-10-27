import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";

export type City = Tables<"cities">;
export type Area = Tables<"areas">;

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

export const getUnreadCounts = cache(async (): Promise<{ notifications: number; messages: number }> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("unread_counts");
  const v = (data ?? {}) as { notifications?: number; messages?: number };
  return { notifications: Number(v.notifications ?? 0), messages: Number(v.messages ?? 0) };
});
