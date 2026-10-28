"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { fail, ok, zodFieldErrors, type ActionState } from "@/lib/actions";
import { safeNext } from "@/lib/auth";
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

function authErrorCode(message: string | undefined, status?: number): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "invalid_credentials";
  if (m.includes("email not confirmed")) return "email_not_confirmed";
  if (m.includes("already registered") || m.includes("already been registered")) return "email_taken";
  if (m.includes("weak") || m.includes("password should")) return "weak_password";
  if (status === 429 || m.includes("rate limit")) return "rate_limited";
  return "auth_failed";
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
    const code = authErrorCode(error.message, error.status);
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
  if (error) return fail(authErrorCode(error.message, error.status));
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
  if (error?.code === "over_email_send_rate_limit") return fail("resend_too_soon");
  if (error && error.status === 429) return fail("rate_limited");
  if (error) logger.warn("resend_code_failed", { status: error.status });
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
  // Same response whether or not the address exists (no account enumeration).
  if (error && error.status === 429) return fail("rate_limited");
  if (error) logger.warn("password_reset_failed", { status: error.status });
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
  if (error) return fail(authErrorCode(error.message, error.status));
  redirect({ href: "/dashboard", locale: await currentLocale() });
  return ok();
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/", locale: await currentLocale() });
}
