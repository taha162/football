"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { bool, dbErrorCode, fail, ok, str, uuid, zodFieldErrors, type ActionState } from "@/lib/actions";
import { getCurrentUser } from "@/lib/auth";
import { logger } from "@/lib/log";
import { normalizePhone, PHONE_ACCOUNT_DOMAIN } from "@/lib/phone";
import { clearVerifyTicket, createVerification, getVerifyTicket, hashTicket } from "@/lib/phone-verification";
import { inspectImage, randomFileName, UPLOAD_CACHE_SECONDS } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameField, usernameFree } from "@/lib/username-server";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { buckets, count } from "@/lib/throttle";
import { bot, whatsappConfig } from "@/lib/whatsapp";
import { deliverWhatsapp } from "@/lib/whatsapp-outbox";

async function currentLocale(): Promise<Locale> {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

/** The WhatsApp number typed on the form (07…, +964…, Arabic digits all fine), as E.164 digits. */
const typedPhone = z
  .string()
  .trim()
  .refine((v) => normalizePhone(v) !== null, "invalid_phone")
  .transform((v) => normalizePhone(v)!);

/**
 * Sign-up without e-mail: the user types their WhatsApp number, and the
 * account is activated when they send the code from that number's WhatsApp.
 */
export async function startWhatsappSignupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const wa = whatsappConfig();
  if (!wa.enabled) return fail("whatsapp_unavailable");
  const parsed = z
    .object({
      display_name: z.string().trim().min(2, "too_short").max(40, "too_long"),
      username: usernameField,
      phone: typedPhone,
      password: z.string().min(8, "password_too_short").max(72, "password_too_long"),
      accept_terms: z.literal("on", { message: "must_accept_terms" }),
    })
    .safeParse({
      display_name: fd.get("display_name"),
      username: fd.get("username") ?? "",
      phone: fd.get("phone") ?? "",
      password: fd.get("password"),
      accept_terms: fd.get("accept_terms") ?? undefined,
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  // The same per-device limit as the other sign-ups, counted before any account exists.
  if (!(await count(await buckets(["signupDevice"])))) return fail("too_many_attempts");
  const locale = await currentLocale();
  const admin = createAdminClient()!;
  if ((await usernameFree(admin, parsed.data.username)) === "taken") return fail("validation", { username: "username_taken" });
  const { data, error } = await admin.auth.admin.createUser({
    email: `wa_${randomUUID().replace(/-/g, "")}@${PHONE_ACCOUNT_DOMAIN}`,
    password: parsed.data.password,
    email_confirm: false,
    // The profile takes the username if still free (migration 0041).
    user_metadata: { display_name: parsed.data.display_name, username: parsed.data.username, locale, signup_method: "whatsapp" },
  });
  if (error || !data.user) {
    logger.warn("whatsapp_signup_create_failed", { status: error?.status });
    return fail(error?.message?.toLowerCase().includes("password") ? "weak_password" : "auth_failed");
  }
  // Offers on WhatsApp come with signing up with WhatsApp (the form says so, with a ticked box that
  // can't be unticked), whenever offers can be sent at all. Settings or "0" turns them off later.
  if (wa.canSend) {
    const { error: consentError } = await admin.rpc("wa_signup_consent", { p_user_id: data.user.id, p_promos: true });
    if (consentError) logger.warn("whatsapp_signup_consent_failed", { code: consentError.code });
  }
  const failure = await createVerification("signup", data.user.id, parsed.data.phone);
  if (failure) {
    await admin.auth.admin.deleteUser(data.user.id);
    return fail(failure);
  }
  redirect({ href: "/verify-whatsapp", locale });
  return ok();
}

/**
 * Password recovery for phone accounts: the user types the account's number
 * and sends the code from that number's WhatsApp, which identifies the account.
 */
export async function startWhatsappResetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!whatsappConfig().enabled) return fail("whatsapp_unavailable");
  const phone = typedPhone.safeParse(fd.get("phone") ?? "");
  if (!phone.success) return fail("validation", { phone: "invalid_phone" });
  const failure = await createVerification("reset", null, phone.data);
  if (failure) return fail(failure);
  redirect({ href: "/verify-whatsapp", locale: await currentLocale() });
  return ok();
}

export type VerificationPoll =
  | { state: "pending" }
  | { state: "expired" | "phone_taken" | "no_account" | "missing" }
  | { state: "done"; href: string };

/**
 * Polled by the waiting page. Once the bot has verified the number, opens a
 * session for the account (one-time) and returns where to continue.
 */
export async function pollWhatsappAction(): Promise<VerificationPoll> {
  const ticket = await getVerifyTicket();
  const admin = createAdminClient();
  if (!ticket || !admin) return { state: "missing" };
  const hash = hashTicket(ticket);
  const { data, error: lookupError } = await admin.rpc("phone_verify_lookup", { p_ticket_hash: hash });
  if (lookupError) {
    // A passing database hiccup shouldn't end the wait: the page asks again in a moment.
    logger.warn("phone_verify_poll_failed", { code: lookupError.code });
    return { state: "pending" };
  }
  const row = data?.[0];
  if (!row) return { state: "missing" };
  if (row.status === "pending") return new Date(row.expires_at) <= new Date() ? { state: "expired" } : { state: "pending" };
  if (row.status === "phone_taken" || row.status === "no_account") return { state: row.status };
  if (row.status !== "verified") return { state: "missing" };

  const { data: consumed, error } = await admin.rpc("phone_verify_consume", { p_ticket_hash: hash });
  const account = consumed?.[0];
  if (error || !account?.email) return { state: "missing" };
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: account.email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) {
    logger.error("phone_verify_session_failed", { status: link.error?.status });
    return { state: "missing" };
  }
  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (verifyError) {
    logger.error("phone_verify_session_failed", { status: verifyError.status });
    return { state: "missing" };
  }
  await clearVerifyTicket();
  const locale = await currentLocale();
  return { state: "done", href: account.purpose === "signup" ? `/${locale}/onboarding` : `/${locale}/reset-password` };
}

/** Settings: booking messages and offers on WhatsApp, each on or off. */
export async function saveWhatsappSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_whatsapp_settings", { p_bookings: bool(fd, "wa_bookings"), p_promos: bool(fd, "wa_promos") });
  if (error) return fail(dbErrorCode(error, "set_my_whatsapp_settings"));
  revalidatePath("/[locale]/settings", "page");
  return ok("whatsapp_settings_saved");
}

// ---- Admin: promotions ----------------------------------------------------------

async function refused(action: string, code: string) {
  if (code === "forbidden" || code === "not_authenticated" || code === "mfa_required") {
    logger.warn("admin_action_refused", { action, code, by: (await getCurrentUser())?.id ?? null });
  }
}

/** Starts a campaign to everyone who opted in (or one city's). The database checks the admin role. */
export async function startCampaignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!whatsappConfig().canSend) return fail("whatsapp_not_configured");
  const parsed = z
    .object({
      body: z.string().trim().min(5, "too_short").max(1000, "too_long"),
      city_id: uuid.optional(),
      // A place: one of the venues, by its coordinates.
      venue_id: uuid.optional(),
      link: z
        .string()
        .trim()
        .max(500, "too_long")
        .refine((v) => /^https:\/\/[^\s]+$/.test(v), "invalid_link")
        .optional(),
    })
    .safeParse({ body: fd.get("body"), city_id: str(fd, "city_id"), venue_id: str(fd, "venue_id"), link: str(fd, "link") });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  if (!(await getCurrentUser())?.isAdmin) {
    await refused("admin_start_promo_campaign", "forbidden");
    return fail("forbidden");
  }
  const supabase = await createClient();

  // The picture, if any: a JPG or PNG (WhatsApp shows those as photos), under a new name.
  // Storage lets only admins write to promo-images; the database checks it is there.
  let imagePath: string | null = null;
  const file = fd.get("image");
  if (file instanceof File && file.size > 0) {
    const img = await inspectImage(file);
    if (!img.ok) return fail("validation", { image: img.error });
    if (img.ext !== "jpg" && img.ext !== "png") return fail("validation", { image: "promo_image_type" });
    imagePath = randomFileName(img.ext);
    const { error: upError } = await supabase.storage
      .from("promo-images")
      .upload(imagePath, img.bytes, { cacheControl: UPLOAD_CACHE_SECONDS, contentType: img.mime, upsert: false });
    if (upError) {
      logger.warn("promo_image_upload_failed", { message: upError.message.slice(0, 120) });
      return fail("upload_failed");
    }
  }
  const forget = async () => {
    if (imagePath) await supabase.storage.from("promo-images").remove([imagePath]);
  };

  const { data, error } = await supabase.rpc("admin_start_promo_campaign", {
    p_body: parsed.data.body,
    p_city_id: parsed.data.city_id as string,
    ...(imagePath ? { p_image_path: imagePath } : {}),
    ...(parsed.data.venue_id ? { p_venue_id: parsed.data.venue_id } : {}),
    ...(parsed.data.link ? { p_link_url: parsed.data.link } : {}),
  });
  if (error) {
    await forget();
    // A database without 0031 knows no picture, place or link.
    if (error.code === "PGRST202") return fail("promo_media_unavailable");
    const code = dbErrorCode(error, "admin_start_promo_campaign");
    await refused("admin_start_promo_campaign", code);
    return fail(code);
  }
  const started = data as { campaign_id: string; recipients: number };
  logger.info("whatsapp_campaign_started", { campaign: started.campaign_id, recipients: started.recipients });
  // The first small batch goes to the bot now rather than at the next scheduled run.
  after(() => deliverWhatsapp().then(() => undefined));
  revalidatePath("/[locale]/admin/promotions", "page");
  return ok("campaign_started", { recipients: started.recipients });
}

/** Stops a campaign: what waits in the site is skipped; the bot drops what it still holds. */
export async function stopCampaignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("campaign_id"));
  if (!id.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stop_promo_campaign", { p_campaign_id: id.data });
  if (error) {
    const code = dbErrorCode(error, "admin_stop_promo_campaign");
    await refused("admin_stop_promo_campaign", code);
    return fail(code);
  }
  const inFlight = ((data as { in_flight?: string[] } | null)?.in_flight ?? []).filter((x) => typeof x === "string");
  if (inFlight.length > 0) {
    const res = await bot.cancel(inFlight, "campaign_stopped");
    const admin = createAdminClient();
    if (res.ok && admin && res.data.cancelled.length > 0) {
      const results = res.data.cancelled.map((cid) => ({ id: cid, state: "cancelled", error: "campaign_stopped" }));
      const { error: reportError } = await admin.rpc("wa_outbox_delivered", { p_results: results as unknown as Json });
      if (reportError) logger.error("whatsapp_outbox_failed", { step: "cancel", code: reportError.code });
    } else if (!res.ok) {
      // The bot was unreachable: what it already holds may still go out.
      logger.warn("whatsapp_campaign_cancel_failed", { campaign: id.data, reason: res.error });
    }
  }
  logger.info("whatsapp_campaign_stopped", { campaign: id.data });
  revalidatePath("/[locale]/admin/promotions", "page");
  return ok("campaign_stopped");
}

/** Admin only: lets a paused bot send again (after the reason for the pause was dealt with). */
export async function resumeWhatsappAction(): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user?.isAdmin) {
    await refused("whatsapp_resume", "forbidden");
    return fail("forbidden");
  }
  const res = await bot.resume();
  if (!res.ok) return fail("whatsapp_bot_unreachable");
  logger.info("whatsapp_bot_resumed", { by: user.id });
  revalidatePath("/[locale]/admin", "layout");
  return ok("whatsapp_resumed");
}
