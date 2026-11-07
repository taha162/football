"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorCode, fail, ok, str, uuid, type ActionState } from "@/lib/actions";
import { logger } from "@/lib/log";
import { removeMessageFiles } from "@/lib/message-files";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Rpc = Parameters<Awaited<ReturnType<typeof createClient>>["rpc"]>[0];

/** All admin RPCs authorize the caller in the database (require_admin / require_moderator). */
async function run(fn: Rpc, args: Record<string, unknown>, success: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args as never);
  if (error) {
    const code = dbErrorCode(error, fn);
    // Someone without the role tried a moderator or admin action: a security event, not just a failed form.
    if (code === "forbidden" || code === "not_authenticated" || code === "mfa_required") {
      const { data } = await supabase.auth.getUser();
      logger.warn("admin_action_refused", { action: fn, code, by: data.user?.id ?? null });
    }
    return fail(code);
  }
  revalidatePath("/[locale]/admin", "layout");
  return ok(success);
}

export async function setUserStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = uuid.safeParse(fd.get("user_id"));
  const status = z.enum(["active", "suspended"]).safeParse(fd.get("status"));
  if (!user.success || !status.success) return fail("invalid");
  const res = await run("admin_set_user_status", { p_user_id: user.data, p_status: status.data, p_reason: str(fd, "reason") }, status.data === "suspended" ? "user_suspended" : "user_restored");
  if (res?.ok) {
    // Additionally revoke/restore sign-in at the auth layer when the service key is configured.
    // The database already blocks every action of suspended users regardless.
    const adminClient = createAdminClient();
    if (adminClient) {
      const { error } = await adminClient.auth.admin.updateUserById(user.data, { ban_duration: status.data === "suspended" ? "876000h" : "none" });
      if (error) logger.warn("auth_ban_failed", { status: error.status });
    }
  }
  return res;
}

/**
 * Someone lost the phone with their authenticator app: an admin removes it so
 * they can sign in with the password alone (and set it up again). The database
 * authorizes it (admins only, never their own) and records it first; the
 * factors are then deleted through the Auth admin API.
 */
export async function resetSecondFactorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = uuid.safeParse(fd.get("user_id"));
  if (!user.success) return fail("invalid");
  const adminClient = createAdminClient();
  if (!adminClient) {
    logger.error("second_factor_reset_failed", { hint: "SUPABASE_SERVICE_ROLE_KEY is not set" });
    return fail("generic");
  }
  const res = await run("admin_reset_second_factor", { p_user_id: user.data, p_reason: str(fd, "reason") }, "second_factor_reset");
  if (!res?.ok) return res;
  const { data, error } = await adminClient.auth.admin.mfa.listFactors({ userId: user.data });
  if (error) {
    logger.error("second_factor_reset_failed", { status: error.status, code: error.code });
    return fail("generic");
  }
  for (const factor of data.factors) {
    const { error: deleteError } = await adminClient.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.data });
    if (deleteError) {
      logger.error("second_factor_reset_failed", { status: deleteError.status, code: deleteError.code });
      return fail("generic");
    }
  }
  logger.info("second_factor_reset", { user: user.data });
  return res;
}

export async function setRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = uuid.safeParse(fd.get("user_id"));
  const role = z.enum(["admin", "moderator"]).safeParse(fd.get("role"));
  if (!user.success || !role.success) return fail("invalid");
  return run("admin_set_role", { p_user_id: user.data, p_role: role.data, p_grant: fd.get("grant") === "1" }, "role_updated");
}

export async function setHiddenAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const entity = z.enum(["match", "team", "venue", "tournament", "review"]).safeParse(fd.get("entity_type"));
  const id = uuid.safeParse(fd.get("entity_id"));
  if (!entity.success || !id.success) return fail("invalid");
  const hidden = fd.get("hidden") === "1";
  return run("admin_set_hidden", { p_entity_type: entity.data, p_entity_id: id.data, p_hidden: hidden, p_reason: str(fd, "reason") }, hidden ? "content_hidden" : "content_restored");
}

export async function removeMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = z.coerce.number().int().positive().safeParse(fd.get("message_id"));
  if (!id.success) return fail("invalid");
  // Moderators needn't belong to the conversation: read the files' paths with the server key.
  const admin = createAdminClient();
  const { data: before } = admin ? await admin.from("messages").select("*").eq("id", id.data).maybeSingle() : { data: null };
  const result = await run("admin_remove_message", { p_message_id: id.data, p_reason: str(fd, "reason") }, "message_removed");
  // Only once the database accepted the removal (the caller is a moderator).
  if (result?.ok) await removeMessageFiles(before);
  return result;
}

export async function setVerificationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const venue = uuid.safeParse(fd.get("venue_id"));
  const status = z.enum(["unverified", "pending", "verified", "rejected"]).safeParse(fd.get("status"));
  if (!venue.success || !status.success) return fail("invalid");
  return run("admin_set_venue_verification", { p_venue_id: venue.data, p_status: status.data, p_note: str(fd, "note") }, "verification_updated");
}

export async function updateReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const report = uuid.safeParse(fd.get("report_id"));
  const status = z.enum(["open", "in_review", "resolved", "dismissed"]).safeParse(fd.get("status"));
  if (!report.success || !status.success) return fail("invalid");
  return run("admin_update_report", { p_report_id: report.data, p_status: status.data, p_note: str(fd, "note") }, "report_updated");
}

export async function cancelMatchAsModeratorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("match_id"));
  if (!id.success) return fail("invalid");
  return run("cancel_match", { p_match_id: id.data, p_reason: str(fd, "reason") }, "match_cancelled");
}

export async function updateSettingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const key = z.string().regex(/^[a-z0-9_.]{3,80}$/).safeParse(fd.get("key"));
  const raw = str(fd, "value");
  if (!key.success || raw == null) return fail("invalid");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail("validation", { value: "invalid_json" });
  }
  return run("admin_update_setting", { p_key: key.data, p_value: value }, "setting_updated");
}

export async function upsertAreaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      id: uuid.optional(),
      city_id: uuid,
      slug: z.string().regex(/^[a-z0-9-]{2,60}$/, "invalid_slug"),
      name_en: z.string().trim().min(2).max(80),
      name_ar: z.string().trim().min(2).max(80),
    })
    .safeParse({ id: str(fd, "id"), city_id: str(fd, "city_id"), slug: str(fd, "slug"), name_en: str(fd, "name_en"), name_ar: str(fd, "name_ar") });
  if (!parsed.success) return fail("validation", { slug: "invalid" });
  const v = parsed.data;
  return run(
    "admin_upsert_area",
    { p_id: v.id ?? null, p_city_id: v.city_id, p_slug: v.slug, p_name_en: v.name_en, p_name_ar: v.name_ar, p_is_active: fd.get("is_active") !== "0" },
    "area_saved",
  );
}

export async function upsertCityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      id: uuid.optional(),
      slug: z.string().regex(/^[a-z0-9-]{2,60}$/, "invalid_slug"),
      name_en: z.string().trim().min(2).max(80),
      name_ar: z.string().trim().min(2).max(80),
      country_code: z.string().regex(/^[A-Za-z]{2}$/),
      timezone: z.string().min(3).max(60),
      currency: z.string().regex(/^[A-Za-z]{3}$/),
    })
    .safeParse({
      id: str(fd, "id"),
      slug: str(fd, "slug"),
      name_en: str(fd, "name_en"),
      name_ar: str(fd, "name_ar"),
      country_code: str(fd, "country_code"),
      timezone: str(fd, "timezone"),
      currency: str(fd, "currency"),
    });
  if (!parsed.success) return fail("validation", { slug: "invalid" });
  const v = parsed.data;
  return run(
    "admin_upsert_city",
    {
      p_id: v.id ?? null,
      p_slug: v.slug,
      p_name_en: v.name_en,
      p_name_ar: v.name_ar,
      p_country_code: v.country_code,
      p_timezone: v.timezone,
      p_currency: v.currency,
      p_is_active: fd.get("is_active") !== "0",
    },
    "city_saved",
  );
}

