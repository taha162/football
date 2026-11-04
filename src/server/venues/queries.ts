import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const VENUE_CARD_SELECT =
  "id, name, cover_image_path, booking_mode, verification_status, deposit_instructions, facilities, city:cities(name_en, name_ar), area:areas(name_en, name_ar), fields:venue_fields(id, price_per_hour, formats, is_active)" as const;

export interface VenueCardData {
  id: string;
  name: string;
  cover_image_path: string | null;
  booking_mode: "platform" | "contact_only";
  verification_status: "unverified" | "pending" | "verified" | "rejected";
  deposit_instructions: string | null;
  facilities: string[];
  city: { name_en: string; name_ar: string } | null;
  area: { name_en: string; name_ar: string } | null;
  fields: { id: string; price_per_hour: number; formats: string[]; is_active: boolean }[];
}

/** Deposit rules for platform bookings (platform settings, which admins edit). */
export const getDepositSettings = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("key, value").in("key", ["booking.deposit_amount", "booking.deposit_hold_minutes"]);
  const setting = (key: string, fallback: number) => {
    const n = Number(data?.find((s) => s.key === key)?.value);
    return Number.isFinite(n) ? n : fallback;
  };
  const amount = Math.max(0, setting("booking.deposit_amount", 5000));
  return { amount, holdMinutes: setting("booking.deposit_hold_minutes", 60), on: amount > 0 };
});

export async function listVenues(opts: { q?: string; city?: string; area?: string; format?: string; bookable?: boolean; page: number }) {
  const supabase = await createClient();
  const size = 18;
  let query = supabase
    .from("venues")
    .select(VENUE_CARD_SELECT)
    .eq("is_hidden", false)
    .order("verification_status", { ascending: false })
    .order("name")
    .range((opts.page - 1) * size, opts.page * size);
  if (opts.q) query = query.ilike("name", `%${opts.q.replace(/[%_\\]/g, "")}%`);
  if (opts.city) query = query.eq("city_id", opts.city);
  if (opts.area) query = query.eq("area_id", opts.area);
  if (opts.bookable) {
    query = query.eq("booking_mode", "platform").eq("verification_status", "verified");
    if ((await getDepositSettings()).on) query = query.not("deposit_instructions", "is", null);
  }
  const { data } = await query;
  let rows = (data ?? []) as unknown as VenueCardData[];
  if (opts.format) rows = rows.filter((v) => v.fields.some((f) => f.is_active && f.formats.includes(opts.format!)));
  return { items: rows.slice(0, size), hasMore: rows.length > size };
}

export const getVenue = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("*, city:cities(id, name_en, name_ar, timezone, currency), area:areas(name_en, name_ar), fields:venue_fields(*, rules:venue_pricing_rules(*)), hours:venue_opening_hours(*), images:venue_images(*)")
    .eq("id", id)
    .maybeSingle();
  return data;
});

export type VenueDetail = NonNullable<Awaited<ReturnType<typeof getVenue>>>;

export async function myVenues(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("venue_staff").select(`role, venue:venues(${VENUE_CARD_SELECT})`).eq("user_id", userId);
  return (data ?? []).flatMap((r) => (r.venue ? [{ role: r.role, venue: r.venue as unknown as VenueCardData }] : []));
}

export async function myVenueRole(venueId: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("venue_staff").select("role").eq("venue_id", venueId).eq("user_id", userId).maybeSingle();
  return data?.role ?? null;
}

/** Busy intervals per field for a local date (no customer details). */
/**
 * The start times ("HH:MM") a field can be booked at on a local date for a
 * duration, by the same rules as a booking request. `null` when they couldn't
 * be loaded, so the page says so instead of showing a day with no times.
 */
export async function freeStartTimes(fieldId: string, date: string, duration: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("free_start_times", { p_field_id: fieldId, p_local_date: date, p_duration_minutes: duration });
  if (error) {
    console.error("free_start_times failed", error.message);
    return null;
  }
  return data ?? [];
}
