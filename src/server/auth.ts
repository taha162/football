"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/actions";
import { safeNext } from "@/lib/auth";
import { authErrorCode, emailDeliveryError } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { clearPendingEmail, getPendingEmail, setPendingEmail } from "@/lib/pending-email";
import { looksLikePhone, normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const email = z.string().trim().toLowerCase().email("invalid_email").max(254);
const password = z.string().min(8, "password_too_short").max(72, "password_too_long");

async function currentLocale(): Promise<Locale> {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

/** E-mail that could not go out is the site's problem, not the visitor's: it is logged too. */
function reportDelivery(code: string, status?: number): string {
  if (code === "email_not_authorized") {
    logger.error("auth_email_not_authorized", { hint: "Supabase's built-in mail service only sends to the project team; set up custom SMTP (DEPLOYMENT.md)" });
  } else if (code === "email_send_failed") {
    logger.error("auth_email_send_failed", { status });
  } else if (code === "email_limit_reached") {
    logger.warn("auth_email_limit_reached", { hint: "raise Authentication > Rate Limits in Supabase" });
  }
  return code;
}

export async function signInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const login = String(fd.get("email") ?? "").trim();
  const pass = z.string().min(1, "required").safeParse(fd.get("password"));
  if (!pass.success) return fail("validation", { password: "required" });

  let address: string;
  if (looksLikePhone(login)) {
    // Phone sign-in (WhatsApp-verified accounts): map the number to its auth address.
    const phone = normalizePhone(login);
    const admin = createAdminClient();
    if (!phone) return fail("validation", { email: "invalid_phone" });
    const { data } = admin ? await admin.rpc("wa_auth_email_for_phone", { p_phone: phone }) : { data: null };
    if (!data) return fail("invalid_credentials");
    address = data as string;
  } else {
    const parsed = email.safeParse(login);
    if (!parsed.success) return fail("validation", { email: "invalid_email" });
    address = parsed.data;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: address, password: pass.data });
  if (error) {
    const code = authErrorCode(error);
    if (code === "email_not_confirmed") {
      await setPendingEmail(address);
      redirect({ href: "/verify-email", locale: await currentLocale() });
    }
    return fail(code);
  }
  const { data: prefs } = await supabase.from("user_preferences").select("locale").eq("user_id", data.user.id).maybeSingle();
  const locale = isLocale(prefs?.locale) ? prefs.locale : await currentLocale();
  redirect({ href: safeNext(fd.get("next")), locale });
  return ok();
}

export async function signUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      display_name: z.string().trim().min(2, "too_short").max(40, "too_long"),
      email,
      password,
      accept_terms: z.literal("on", { message: "must_accept_terms" }),
    })
    .safeParse({
      display_name: fd.get("display_name"),
      email: fd.get("email"),
      password: fd.get("password"),
      accept_terms: fd.get("accept_terms") ?? undefined,
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const locale = await currentLocale();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.display_name, locale },
      emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=/${locale}/onboarding`,
    },
  });
  if (error) return fail(reportDelivery(authErrorCode(error), error.status));
  // An address that already has a confirmed account: depending on the project,
  // Supabase refuses (above) or answers with an empty stand-in user and sends
  // nothing. Either way, no code is coming.
  if (data.user && data.user.identities?.length === 0) return fail("email_taken");
  // With e-mail confirmation enabled there is no session until the code is entered.
  if (!data.session) {
    await setPendingEmail(parsed.data.email);
    redirect({ href: "/verify-email", locale });
  }
  redirect({ href: "/onboarding", locale });
  return ok();
}

export async function verifyEmailCodeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const address = await getPendingEmail();
  if (!address) return fail("verification_missing");
  const token = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^[0-9]{6,10}$/.test(token)) return fail("validation", { code: "invalid_code" });
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
  if (error) return fail(error.status === 429 ? "rate_limited" : "invalid_code");
  await clearPendingEmail();
  redirect({ href: "/onboarding", locale: await currentLocale() });
  return ok();
}

export async function resendEmailCodeAction(): Promise<ActionState> {
  const address = await getPendingEmail();
  if (!address) return fail("verification_missing");
  const locale = await currentLocale();
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: address,
    options: { emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=/${locale}/onboarding` },
  });
  // "Sent" only when Supabase accepted the e-mail.
  if (error) return fail(reportDelivery(emailDeliveryError(error) ?? (error.status === 429 ? "rate_limited" : "email_send_failed"), error.status));
  return ok("code_sent");
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = email.safeParse(fd.get("email"));
  if (!parsed.success) return fail("validation", { email: "invalid_email" });
  const locale = await currentLocale();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/${locale}/reset-password`,
  });
  // Supabase answers an unknown address without sending anything, so the reply
  // never reveals whether an account exists; e-mail that failed is reported.
  if (error) {
    const code = emailDeliveryError(error) ?? (error.status === 429 ? "rate_limited" : "email_send_failed");
    return fail(reportDelivery(code === "resend_too_soon" ? "rate_limited" : code, error.status));
  }
  return ok("reset_sent");
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "passwords_mismatch", path: ["confirm"] })
    .safeParse({ password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return fail("reset_link_expired");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(authErrorCode(error));
  redirect({ href: "/dashboard", locale: await currentLocale() });
  return ok();
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/", locale: await currentLocale() });
}
