"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { fail, ok, type ActionState } from "@/lib/actions";
import { safeNext } from "@/lib/auth";
import { emailDeliveryError } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { clearPendingEmail, getPendingEmail, setPendingEmail } from "@/lib/pending-email";
import { hasSecondFactor } from "@/lib/second-factor";
import { PUSH_TOKEN_COOKIE } from "@/lib/push/device-cookie";
import { createClient } from "@/lib/supabase/server";
import { passwordSignIn } from "@/server/sign-in-core";
import { reportDelivery, resetWithEmail, setNewPassword, signUpWithEmail, verifyEmailCode } from "@/server/signup-core";
import { buckets, count } from "@/lib/throttle";


async function currentLocale(): Promise<Locale> {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}


export async function signInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  // The WhatsApp number (the main way, field "phone") or the e-mail; a number typed as the e-mail still works.
  const field = fd.has("phone") ? "phone" : "email";
  const supabase = await createClient();
  const result = await passwordSignIn(supabase, field, String(fd.get(field) ?? "").trim(), String(fd.get("password") ?? ""));
  if (!result.ok) {
    if (result.field) return fail("validation", { [result.field.name]: result.field.error });
    if (result.code === "email_not_confirmed" && result.address) {
      await setPendingEmail(result.address);
      redirect({ href: "/verify-email", locale: await currentLocale() });
    }
    return fail(result.code);
  }
  // With an authenticator app, the password is only the first step: the code comes next.
  if (hasSecondFactor(result.user)) {
    redirect({ href: { pathname: "/mfa", query: { next: safeNext(fd.get("next")) } }, locale: await currentLocale() });
  }
  const { data: prefs } = await supabase.from("user_preferences").select("locale").eq("user_id", result.user.id).maybeSingle();
  const locale = isLocale(prefs?.locale) ? prefs.locale : await currentLocale();
  redirect({ href: safeNext(fd.get("next")), locale });
  return ok();
}

export async function signUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const locale = await currentLocale();
  const supabase = await createClient();
  const result = await signUpWithEmail(supabase, {
    display_name: fd.get("display_name"),
    username: fd.get("username") ?? "",
    email: fd.get("email"),
    password: fd.get("password"),
    accept_terms: fd.get("accept_terms") ?? undefined,
  }, locale);
  if (!result.ok) return fail(result.code, result.fields);
  // With e-mail confirmation enabled there is no session until the code is entered.
  if (!result.session) {
    await setPendingEmail(result.email);
    redirect({ href: "/verify-email", locale });
  }
  redirect({ href: "/onboarding", locale });
  return ok();
}

export async function verifyEmailCodeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const address = await getPendingEmail();
  if (!address) return fail("verification_missing");
  const result = await verifyEmailCode(await createClient(), address, fd.get("code"), "email");
  if (!result.ok) return fail(result.code, result.fields);
  await clearPendingEmail();
  redirect({ href: "/onboarding", locale: await currentLocale() });
  return ok();
}

export async function resendEmailCodeAction(): Promise<ActionState> {
  const address = await getPendingEmail();
  if (!address) return fail("verification_missing");
  if (!(await count(await buckets([], [["resendAccount", address]])))) return fail("too_many_attempts");
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
  // Supabase answers an unknown address without sending anything, so the reply never reveals whether an account exists.
  const result = await resetWithEmail(await createClient(), fd.get("email"), await currentLocale());
  if (!result.ok) return fail(result.code, result.fields);
  return ok("reset_sent");
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const result = await setNewPassword(await createClient(), { password: fd.get("password"), confirm: fd.get("confirm") });
  if (!result.ok) return fail(result.code, result.fields);
  redirect({ href: "/dashboard", locale: await currentLocale() });
  return ok();
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  // In the phone app: this phone stops receiving the member's notifications (migration 0051).
  const jar = await cookies();
  const pushToken = jar.get(PUSH_TOKEN_COOKIE)?.value;
  if (pushToken) {
    await supabase.rpc("unregister_push_device", { p_token: pushToken });
    jar.delete(PUSH_TOKEN_COOKIE);
  }
  await supabase.auth.signOut();
  redirect({ href: "/", locale: await currentLocale() });
}
