"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { bool, dbErrorCode, fail, ok, str, strs, uuid, zodFieldErrors, type ActionState } from "@/lib/actions";
import { getCurrentUser, safeNext } from "@/lib/auth";
import { MATCH_FORMATS, POSITIONS, SKILL_LEVELS } from "@/lib/domain/match";
import { inspectImage, randomFileName } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const TIMES = [
  "weekday_morning", "weekday_afternoon", "weekday_evening", "weekday_night",
  "weekend_morning", "weekend_afternoon", "weekend_evening", "weekend_night",
] as const;

const profileSchema = z.object({
  display_name: z.string().trim().min(2, "too_short").max(40, "too_long"),
  city_id: uuid,
  area_id: uuid.optional(),
  bio: z.string().max(500, "too_long").optional(),
  positions: z.array(z.enum(POSITIONS)).max(4),
  skill_level: z.enum(SKILL_LEVELS).optional(),
  preferred_formats: z.array(z.enum(MATCH_FORMATS)).max(6),
  preferred_times: z.array(z.enum(TIMES)).max(8),
  show_match_history: z.boolean(),
});

export async function saveProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = profileSchema.safeParse({
    display_name: str(fd, "display_name"),
    city_id: str(fd, "city_id"),
    area_id: str(fd, "area_id"),
    bio: str(fd, "bio"),
    positions: strs(fd, "positions"),
    skill_level: str(fd, "skill_level"),
    preferred_formats: strs(fd, "preferred_formats"),
    preferred_times: strs(fd, "preferred_times"),
    show_match_history: bool(fd, "show_match_history"),
  });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const onboarding = bool(fd, "onboarding");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_display_name: v.display_name,
    p_city_id: v.city_id,
    p_area_id: v.area_id,
    p_bio: v.bio,
    p_positions: v.positions,
    p_skill_level: v.skill_level,
    p_preferred_formats: v.preferred_formats,
    p_show_match_history: v.show_match_history,
    p_complete_onboarding: onboarding,
  });
  if (error) return fail(dbErrorCode(error, "update_my_profile"));
  const { error: prefError } = await supabase.rpc("update_my_preferences", { p_preferred_times: v.preferred_times });
  if (prefError) return fail(dbErrorCode(prefError, "update_my_preferences"));
  revalidatePath("/", "layout");
  if (onboarding) {
    const locale = await getLocale();
    redirect({ href: safeNext(fd.get("next"), "/dashboard"), locale: isLocale(locale) ? locale : "ar" });
  }
  return ok("profile_saved");
}

export async function uploadAvatarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return fail("not_authenticated");
  const file = fd.get("avatar");
  if (!(file instanceof File)) return fail("file_missing");
  const img = await inspectImage(file);
  if (!img.ok) return fail(img.error);
  const supabase = await createClient();
  const path = `${user.id}/${randomFileName(img.ext)}`;
  // Storage policies only allow writing into the caller's own folder.
  const { error: upErr } = await supabase.storage.from("avatars").upload(path, img.bytes, { contentType: img.mime, upsert: false });
  if (upErr) return fail("upload_failed");
  const { error } = await supabase.rpc("set_my_avatar", { p_path: path });
  if (error) {
    await supabase.storage.from("avatars").remove([path]);
    return fail(dbErrorCode(error, "set_my_avatar"));
  }
  if (user.profile.avatar_path) await supabase.storage.from("avatars").remove([user.profile.avatar_path]);
  revalidatePath("/", "layout");
  return ok("avatar_updated");
}

export async function removeAvatarAction(_: ActionState): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return fail("not_authenticated");
  const supabase = await createClient();
  // The generated types do not model nullable SQL arguments; null clears the avatar.
  const { error } = await supabase.rpc("set_my_avatar", { p_path: null as unknown as string });
  if (error) return fail(dbErrorCode(error, "set_my_avatar"));
  if (user.profile.avatar_path) await supabase.storage.from("avatars").remove([user.profile.avatar_path]);
  revalidatePath("/", "layout");
  return ok("avatar_removed");
}

export async function savePreferencesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const locale = str(fd, "locale");
  if (locale && !isLocale(locale)) return fail("validation", { locale: "invalid" });
  const disabled = new Set(strs(fd, "muted"));
  const prefs = Object.fromEntries([...disabled].filter((k) => /^[a-z_]{3,60}$/.test(k)).map((k) => [k, false]));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_preferences", { p_locale: locale, p_notification_prefs: prefs });
  if (error) return fail(dbErrorCode(error, "update_my_preferences"));
  revalidatePath("/", "layout");
  if (locale && locale !== (await getLocale())) redirect({ href: "/settings", locale });
  return ok("preferences_saved");
}

export async function blockUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("user_id"));
  if (!id.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc(bool(fd, "unblock") ? "unblock_user" : "block_user", { p_user_id: id.data });
  if (error) return fail(dbErrorCode(error, "block_user"));
  revalidatePath("/", "layout");
  return ok(bool(fd, "unblock") ? "user_unblocked" : "user_blocked");
}
