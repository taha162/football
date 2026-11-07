"use server";

import { randomUUID } from "node:crypto";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, zodFieldErrors, type ActionState } from "@/lib/actions";
import { getCurrentUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { PHONE_ACCOUNT_DOMAIN } from "@/lib/phone";
import { clearVerifyTicket, clientKey, getVerifyTicket, hashTicket, newTicket, newVerificationCode, setVerifyTicket } from "@/lib/phone-verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { registerWebhook, telegramConfig } from "@/lib/telegram";
import { buckets, count } from "@/lib/throttle";

async function currentLocale(): Promise<Locale> {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

/** Creates the verification row, retrying on the (unlikely) clash with another pending code. */
async function createVerification(purpose: "signup" | "reset", userId: string | null): Promise<string | null> {
  const admin = createAdminClient()!;
  const key = await clientKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { ticket, hash } = newTicket();
    const { error } = await admin.rpc("phone_verify_start", {
      p_purpose: purpose,
      p_code: newVerificationCode(),
      p_ticket_hash: hash,
      p_user_id: userId as string,
      p_client_key: key,
    });
    if (!error) {
      await setVerifyTicket(ticket);
      return null;
    }
    if (error.code !== "23505") return dbErrorCode(error, "phone_verify_start");
  }
  return "generic";
}

/** Sign-up without e-mail: the account is activated once the user shares their number with the bot. */
export async function startTelegramSignupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!telegramConfig().enabled) return fail("telegram_unavailable");
  const parsed = z
    .object({
      display_name: z.string().trim().min(2, "too_short").max(40, "too_long"),
      password: z.string().min(8, "password_too_short").max(72, "password_too_long"),
      accept_terms: z.literal("on", { message: "must_accept_terms" }),
    })
    .safeParse({ display_name: fd.get("display_name"), password: fd.get("password"), accept_terms: fd.get("accept_terms") ?? undefined });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  // The same per-device limit as e-mail sign-ups, checked before any account is created:
  // otherwise every request past the limit would still create (and then delete) an account.
  if (!(await count(await buckets(["signupDevice"])))) return fail("too_many_attempts");
  const locale = await currentLocale();
  const admin = createAdminClient()!;
  const { data, error } = await admin.auth.admin.createUser({
    email: `tg_${randomUUID().replace(/-/g, "")}@${PHONE_ACCOUNT_DOMAIN}`,
    password: parsed.data.password,
    email_confirm: false,
    user_metadata: { display_name: parsed.data.display_name, locale, signup_method: "telegram" },
  });
  if (error || !data.user) {
    logger.warn("telegram_signup_create_failed", { status: error?.status });
    return fail(error?.message?.toLowerCase().includes("password") ? "weak_password" : "auth_failed");
  }
  const failure = await createVerification("signup", data.user.id);
  if (failure) {
    await admin.auth.admin.deleteUser(data.user.id);
    return fail(failure);
  }
  redirect({ href: "/verify-telegram", locale });
  return ok();
}

/** Password recovery for phone accounts: the number shared with the bot identifies the account. */
export async function startTelegramResetAction(): Promise<ActionState> {
  if (!telegramConfig().enabled) return fail("telegram_unavailable");
  const failure = await createVerification("reset", null);
  if (failure) return fail(failure);
  redirect({ href: "/verify-telegram", locale: await currentLocale() });
  return ok();
}

export type TelegramPoll =
  | { state: "pending"; linked: boolean }
  | { state: "expired" | "phone_taken" | "no_account" | "missing" }
  | { state: "done"; href: string };

/**
 * Polled by the waiting page. Once the bot has verified the number, opens a
 * session for the account (one-time) and returns where to continue.
 */
export async function pollTelegramAction(): Promise<TelegramPoll> {
  const ticket = await getVerifyTicket();
  const admin = createAdminClient();
  if (!ticket || !admin) return { state: "missing" };
  const hash = hashTicket(ticket);
  const { data } = await admin.rpc("phone_verify_lookup", { p_ticket_hash: hash });
  const row = data?.[0];
  if (!row) return { state: "missing" };
  if (row.status === "pending") return new Date(row.expires_at) <= new Date() ? { state: "expired" } : { state: "pending", linked: row.linked };
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

/** Admin only: points the bot's webhook at this site. */
export async function connectTelegramAction(): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return fail("forbidden");
  const cfg = telegramConfig();
  if (!cfg.enabled) return fail("telegram_unavailable");
  const result = await registerWebhook(cfg.token, `${publicEnv.siteUrl}/api/telegram/webhook`);
  if (!result.ok) {
    logger.warn("telegram_webhook_register_failed", { reason: result.error.slice(0, 120) });
    return fail(result.error === "Unauthorized" ? "telegram_token_rejected" : "telegram_connect_failed");
  }
  logger.info("telegram_webhook_registered", { by: user.id });
  return ok("telegram_connected");
}
