"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { bool, dbErrorCode, fail, intIn, localDateTime, ok, str, strs, uuid, zodFieldErrors, type ActionState } from "@/lib/actions";
import { MATCH_FORMATS } from "@/lib/domain/match";
import { FACILITIES, SURFACES } from "@/lib/domain/venue";
import { parseMoneyInput } from "@/lib/domain/money";
import { toRpcLocal } from "@/lib/format";
import { logger } from "@/lib/log";
import { inspectImage, isPubliclyServed, randomFileName } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

type Rpc = Parameters<Awaited<ReturnType<typeof createClient>>["rpc"]>[0];


async function run(fn: Rpc, args: Record<string, unknown>, venueId: string | undefined, success: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) return fail(dbErrorCode(error, fn));
  if (venueId) {
    revalidatePath(`/[locale]/venues/${venueId}`, "layout");
    revalidatePath(`/[locale]/manage/venues/${venueId}`, "layout");
  }
  revalidatePath("/[locale]/my/bookings", "page");
  return ok(success, data);
}

async function locale() {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

const money = (v: string | undefined, ctx: z.RefinementCtx) => {
  if (v == null) return undefined;
  const n = parseMoneyInput(v, "IQD");
  if (n == null) {
    ctx.addIssue({ code: "custom", message: "invalid_amount" });
    return z.NEVER;
  }
  return n;
};

const coord = (min: number, max: number) =>
  z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().min(min, "out_of_range").max(max, "out_of_range").optional());

const venueBase = z.object({
  name: z.string().trim().min(2, "too_short").max(100, "too_long"),
  city_id: uuid,
  area_id: uuid.optional(),
  description: z.string().max(2000, "too_long").optional(),
  address: z.string().max(300, "too_long").optional(),
  latitude: coord(-90, 90),
  longitude: coord(-180, 180),
  phone: z.string().regex(/^\+?[0-9 ]{6,20}$/, "invalid_phone").optional(),
  whatsapp: z.string().regex(/^\+?[0-9 ]{6,20}$/, "invalid_phone").optional(),
  facilities: z.array(z.enum(FACILITIES)),
});

function parseVenue(fd: FormData) {
  return venueBase
    .refine((v) => (v.latitude == null) === (v.longitude == null), { message: "coordinates_pair", path: ["longitude"] })
    .safeParse({
      name: str(fd, "name"),
      city_id: str(fd, "city_id"),
      area_id: str(fd, "area_id"),
      description: str(fd, "description"),
      address: str(fd, "address"),
      latitude: str(fd, "latitude"),
      longitude: str(fd, "longitude"),
      phone: str(fd, "phone"),
      whatsapp: str(fd, "whatsapp"),
      facilities: strs(fd, "facilities"),
    });
}

export async function createVenueAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseVenue(fd);
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_venue", {
    p_name: v.name,
    p_city_id: v.city_id,
    p_area_id: v.area_id,
    p_description: v.description,
    p_address: v.address,
    p_latitude: v.latitude,
    p_longitude: v.longitude,
    p_phone: v.phone,
    p_whatsapp: v.whatsapp,
    p_facilities: v.facilities,
  });
  if (error) return fail(dbErrorCode(error, "create_venue"));
  redirect({ href: `/manage/venues/${data as string}`, locale: await locale() });
  return ok();
}

export async function updateVenueAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("venue_id"));
  const parsed = parseVenue(fd);
  const settings = z
    .object({
      booking_mode: z.enum(["platform", "contact_only"]),
      buffer_minutes: intIn(0, 60),
      min_notice_minutes: intIn(0, 10080),
      max_advance_days: intIn(1, 180),
      cancellation_deadline_hours: intIn(0, 168),
      cancellation_policy: z.string().max(1000, "too_long").optional(),
    })
    .safeParse({
      booking_mode: str(fd, "booking_mode") ?? "contact_only",
      buffer_minutes: str(fd, "buffer_minutes") ?? "0",
      min_notice_minutes: str(fd, "min_notice_minutes") ?? "60",
      max_advance_days: str(fd, "max_advance_days") ?? "30",
      cancellation_deadline_hours: str(fd, "cancellation_deadline_hours") ?? "12",
      cancellation_policy: str(fd, "cancellation_policy"),
    });
  if (!id.success) return fail("invalid");
  if (!parsed.success || !settings.success) {
    return fail("validation", { ...(parsed.error ? zodFieldErrors(parsed.error) : {}), ...(settings.error ? zodFieldErrors(settings.error) : {}) });
  }
  const v = parsed.data;
  const s = settings.data;
  return run(
    "update_venue",
    {
      p_venue_id: id.data,
      p_name: v.name,
      p_city_id: v.city_id,
      p_area_id: v.area_id,
      p_description: v.description,
      p_address: v.address,
      p_latitude: v.latitude,
      p_longitude: v.longitude,
      p_phone: v.phone,
      p_whatsapp: v.whatsapp,
      p_facilities: v.facilities,
      p_booking_mode: s.booking_mode,
      p_auto_confirm: bool(fd, "auto_confirm"),
      p_buffer_minutes: s.buffer_minutes,
      p_min_notice_minutes: s.min_notice_minutes,
      p_max_advance_days: s.max_advance_days,
      p_cancellation_deadline_hours: s.cancellation_deadline_hours,
      p_cancellation_policy: s.cancellation_policy,
    },
    id.data,
    "venue_saved",
  );
}

export async function requestVerificationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("venue_id"));
  if (!id.success) return fail("invalid");
  return run("request_venue_verification", { p_venue_id: id.data }, id.data, "verification_requested");
}

export async function upsertFieldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      venue_id: uuid,
      field_id: uuid.optional(),
      name: z.string().trim().min(1, "required").max(60, "too_long"),
      surface: z.enum(SURFACES),
      formats: z.array(z.enum(MATCH_FORMATS)),
      price: z.string().optional().transform(money),
    })
    .safeParse({
      venue_id: str(fd, "venue_id"),
      field_id: str(fd, "field_id"),
      name: str(fd, "name"),
      surface: str(fd, "surface") ?? "artificial_turf",
      formats: strs(fd, "formats"),
      price: str(fd, "price_per_hour"),
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  if (v.price == null) return fail("validation", { price_per_hour: "required" });
  return run(
    "upsert_venue_field",
    {
      p_venue_id: v.venue_id,
      p_field_id: v.field_id ?? null,
      p_name: v.name,
      p_surface: v.surface,
      p_formats: v.formats,
      p_is_covered: bool(fd, "is_covered"),
      p_has_lights: bool(fd, "has_lights"),
      p_price_per_hour: v.price,
      p_is_active: v.field_id ? bool(fd, "is_active") : true,
    },
    v.venue_id,
    "field_saved",
  );
}

export async function setOpeningHoursAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("venue_id"));
  if (!id.success) return fail("invalid");
  const hours: { weekday: number; opens: string; closes: string }[] = [];
  for (let d = 0; d < 7; d++) {
    if (!bool(fd, `open_${d}`)) continue;
    const opens = str(fd, `opens_${d}`);
    const closes = str(fd, `closes_${d}`);
    if (!opens || !closes || !/^\d{2}:\d{2}$/.test(opens) || !/^\d{2}:\d{2}$/.test(closes)) {
      return fail("validation", { [`opens_${d}`]: "invalid" });
    }
    hours.push({ weekday: d, opens, closes });
  }
  return run("set_venue_opening_hours", { p_venue_id: id.data, p_hours: hours }, id.data, "hours_saved");
}

export async function setPricingRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const field = uuid.safeParse(fd.get("field_id"));
  if (!field.success) return fail("invalid");
  const rules: { weekdays: number[]; start_time: string; end_time: string; price_per_hour: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const price = str(fd, `rule_${i}_price`);
    if (!price) continue;
    const amount = parseMoneyInput(price, "IQD");
    const weekdays = strs(fd, `rule_${i}_days`).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    const start = str(fd, `rule_${i}_start`);
    const end = str(fd, `rule_${i}_end`);
    if (amount == null || weekdays.length === 0 || !start || !end || start === end) {
      return fail("validation", { [`rule_${i}_price`]: "invalid_rule" });
    }
    rules.push({ weekdays, start_time: start, end_time: end, price_per_hour: amount });
  }
  return run("set_field_pricing_rules", { p_field_id: field.data, p_rules: rules }, str(fd, "venue_id"), "pricing_saved");
}

export async function addStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const venue = uuid.safeParse(fd.get("venue_id"));
  const user = uuid.safeParse(fd.get("user_id"));
  const role = z.enum(["manager", "staff"]).safeParse(fd.get("role"));
  if (!venue.success || !user.success || !role.success) return fail("invalid");
  return run("add_venue_staff", { p_venue_id: venue.data, p_user_id: user.data, p_role: role.data }, venue.data, "staff_saved");
}

export async function removeStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const venue = uuid.safeParse(fd.get("venue_id"));
  const user = uuid.safeParse(fd.get("user_id"));
  if (!venue.success || !user.success) return fail("invalid");
  return run("remove_venue_staff", { p_venue_id: venue.data, p_user_id: user.data }, venue.data, "staff_removed");
}

export async function uploadVenueImageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const venue = uuid.safeParse(fd.get("venue_id"));
  const file = fd.get("image");
  if (!venue.success || !(file instanceof File)) return fail("file_missing");
  const img = await inspectImage(file);
  if (!img.ok) return fail(img.error);
  const supabase = await createClient();
  const path = `${venue.data}/${randomFileName(img.ext)}`;
  const { error: upErr } = await supabase.storage.from("venue-images").upload(path, img.bytes, { contentType: img.mime });
  if (upErr) return fail("upload_failed");
  if (!(await isPubliclyServed("venue-images", path))) {
    await supabase.storage.from("venue-images").remove([path]);
    logger.error("storage_not_public", { bucket: "venue-images" });
    return fail("storage_not_public");
  }
  const cover = bool(fd, "as_cover");
  const { error } = cover
    ? await supabase.rpc("set_venue_cover", { p_venue_id: venue.data, p_path: path })
    : await supabase.rpc("add_venue_image", { p_venue_id: venue.data, p_path: path });
  if (error) {
    await supabase.storage.from("venue-images").remove([path]);
    return fail(dbErrorCode(error, "add_venue_image"));
  }
  revalidatePath(`/[locale]/venues/${venue.data}`, "layout");
  revalidatePath(`/[locale]/manage/venues/${venue.data}`, "layout");
  return ok("image_uploaded");
}

export async function removeVenueImageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const image = uuid.safeParse(fd.get("image_id"));
  if (!image.success) return fail("invalid");
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("remove_venue_image", { p_image_id: image.data });
  if (error) return fail(dbErrorCode(error, "remove_venue_image"));
  if (path) await supabase.storage.from("venue-images").remove([path as string]);
  revalidatePath(`/[locale]/manage/venues/${str(fd, "venue_id")}`, "layout");
  return ok("image_removed");
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
export async function requestBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({ field_id: uuid, start: localDateTime, duration: intIn(30, 360), note: z.string().max(500, "too_long").optional(), match_id: uuid.optional() })
    .safeParse({ field_id: str(fd, "field_id"), start: str(fd, "start"), duration: str(fd, "duration"), note: str(fd, "note"), match_id: str(fd, "match_id") });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_booking", {
    p_field_id: v.field_id,
    p_start_local: toRpcLocal(v.start),
    p_duration_minutes: v.duration,
    p_note: v.note,
    p_match_id: v.match_id,
  });
  if (error) return fail(dbErrorCode(error, "request_booking"));
  revalidatePath("/[locale]/my/bookings", "page");
  if (v.match_id) revalidatePath(`/[locale]/matches/${v.match_id}`, "page");
  const status = (data as { status: string }).status;
  return ok(status === "confirmed" ? "booking_confirmed" : "booking_requested", data);
}

export async function decideBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("booking_id"));
  if (!id.success) return fail("invalid");
  const approve = bool(fd, "approve");
  return run("decide_booking", { p_booking_id: id.data, p_approve: approve, p_note: str(fd, "note") }, str(fd, "venue_id"), approve ? "booking_approved" : "booking_rejected");
}

export async function cancelBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("booking_id"));
  if (!id.success) return fail("invalid");
  return run("cancel_booking", { p_booking_id: id.data, p_reason: str(fd, "reason") }, str(fd, "venue_id"), "booking_cancelled");
}

export async function manualBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      field_id: uuid,
      start: localDateTime,
      duration: intIn(30, 360),
      kind: z.enum(["manual", "block"]),
      customer_name: z.string().max(100, "too_long").optional(),
      note: z.string().max(500, "too_long").optional(),
      price: z.string().optional().transform(money),
    })
    .safeParse({
      field_id: str(fd, "field_id"),
      start: str(fd, "start"),
      duration: str(fd, "duration"),
      kind: str(fd, "kind") ?? "manual",
      customer_name: str(fd, "customer_name"),
      note: str(fd, "note"),
      price: str(fd, "price"),
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  return run(
    "create_manual_booking",
    {
      p_field_id: v.field_id,
      p_start_local: toRpcLocal(v.start),
      p_duration_minutes: v.duration,
      p_kind: v.kind,
      p_customer_name: v.customer_name,
      p_note: v.note,
      p_price_total: v.price,
    },
    str(fd, "venue_id"),
    v.kind === "block" ? "time_blocked" : "booking_recorded",
  );
}

export async function bookingOutcomeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("booking_id"));
  const status = z.enum(["completed", "no_show"]).safeParse(fd.get("status"));
  if (!id.success || !status.success) return fail("invalid");
  return run("mark_booking_outcome", { p_booking_id: id.data, p_status: status.data }, str(fd, "venue_id"), "saved");
}
