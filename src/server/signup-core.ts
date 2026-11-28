import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zodFieldErrors } from "@/lib/actions";
import { authErrorCode, emailDeliveryError } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { normalizePhone, PHONE_ACCOUNT_DOMAIN } from "@/lib/phone";
import { hashTicket, startVerification } from "@/lib/phone-verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountTag, allowed, buckets, count, countFailure } from "@/lib/throttle";
import { usernameField, usernameFree } from "@/lib/username-server";
import { whatsappConfig } from "@/lib/whatsapp";

/**
 * Making an account and proving it, shared by the site's pages (server/auth.ts,
 * server/whatsapp.ts) and the phone app (/api/app/…): the same checks, limits
 * and logging whichever asks. A session lands in the `client` given: the
 * site's cookies, or a client whose tokens go back to the app.
 */

export const emailField = z.string().trim().toLowerCase().email("invalid_email").max(254);
export const passwordField = z.string().min(8, "password_too_short").max(72, "password_too_long");
const nameField = z.string().trim().min(2, "too_short").max(40, "too_long");
const terms = z.literal("on", { message: "must_accept_terms" });
const typedPhone = z
  .string()
  .trim()
  .refine((v) => normalizePhone(v) !== null, "invalid_phone")
  .transform((v) => normalizePhone(v)!);

export type Failure = { ok: false; code: string; fields?: Record<string, string> };
const failure = (code: string, fields?: Record<string, string>): Failure => ({ ok: false, code, fields });

/** E-mail that could not go out is the site's problem, not the visitor's: it is logged too. */
export function reportDelivery(code: string, status?: number): string {
  if (code === "email_not_authorized") {
    logger.error("auth_email_not_authorized", { hint: "Supabase's built-in mail service only sends to the project team; set up custom SMTP (DEPLOYMENT.md)" });
  } else if (code === "email_send_failed") {
    logger.error("auth_email_send_failed", { status });
  } else if (code === "email_limit_reached") {
    logger.warn("auth_email_limit_reached", { hint: "raise Authentication > Rate Limits in Supabase" });
  }
  return code;
}

type Raw = Record<string, unknown>;

/** An account by e-mail: a code goes to the address (`session` false), or, without confirmation, it is open at once. */
export async function signUpWithEmail(client: SupabaseClient, raw: Raw, locale: string): Promise<Failure | { ok: true; session: boolean; email: string }> {
  const parsed = z
    .object({ display_name: nameField, username: usernameField, email: emailField, password: passwordField, accept_terms: terms })
    .safeParse(raw);
  if (!parsed.success) return failure("validation", zodFieldErrors(parsed.error));
  if (!(await count(await buckets(["signupDevice"])))) return failure("too_many_attempts");
  if ((await usernameFree(client, parsed.data.username)) === "taken") return failure("validation", { username: "username_taken" });
  const { data, error } = await client.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // The profile takes the username if still free (migration 0041).
      data: { display_name: parsed.data.display_name, username: parsed.data.username, locale },
      emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=/${locale}/onboarding`,
    },
  });
  if (error) return failure(reportDelivery(authErrorCode(error), error.status));
  // An address that already has a confirmed account: Supabase refuses (above)
  // or answers with an empty stand-in user and sends nothing. No code is coming.
  if (data.user && data.user.identities?.length === 0) return failure("email_taken");
  return { ok: true, session: Boolean(data.session), email: parsed.data.email };
}

/**
 * An account by WhatsApp number: made now, activated when the member sends the
 * code from that number's WhatsApp. Returns the verification's ticket.
 */
export async function signUpWithWhatsapp(raw: Raw, locale: string): Promise<Failure | { ok: true; ticket: string }> {
  const wa = whatsappConfig();
  if (!wa.enabled) return failure("whatsapp_unavailable");
  const parsed = z
    .object({ display_name: nameField, username: usernameField, phone: typedPhone, password: passwordField, accept_terms: terms })
    .safeParse(raw);
  if (!parsed.success) return failure("validation", zodFieldErrors(parsed.error));
  // The same per-device limit as the other sign-ups, counted before any account exists.
  if (!(await count(await buckets(["signupDevice"])))) return failure("too_many_attempts");
  const admin = createAdminClient()!;
  if ((await usernameFree(admin, parsed.data.username)) === "taken") return failure("validation", { username: "username_taken" });
  const { data, error } = await admin.auth.admin.createUser({
    email: `wa_${randomUUID().replace(/-/g, "")}@${PHONE_ACCOUNT_DOMAIN}`,
    password: parsed.data.password,
    email_confirm: false,
    user_metadata: { display_name: parsed.data.display_name, username: parsed.data.username, locale, signup_method: "whatsapp" },
  });
  if (error || !data.user) {
    logger.warn("whatsapp_signup_create_failed", { status: error?.status });
    return failure(error?.message?.toLowerCase().includes("password") ? "weak_password" : "auth_failed");
  }
  // Offers on WhatsApp come with signing up with WhatsApp (said on the form); settings turn them off.
  if (wa.canSend) {
    const { error: consentError } = await admin.rpc("wa_signup_consent", { p_user_id: data.user.id, p_promos: true });
    if (consentError) logger.warn("whatsapp_signup_consent_failed", { code: consentError.code });
  }
  const started = await startVerification("signup", data.user.id, parsed.data.phone);
  if ("error" in started) {
    await admin.auth.admin.deleteUser(data.user.id);
    return failure(started.error);
  }
  return { ok: true, ticket: started.ticket };
}

/** Password recovery for phone accounts: the number, then the code from its WhatsApp. */
export async function resetWithWhatsapp(phoneRaw: unknown): Promise<Failure | { ok: true; ticket: string }> {
  if (!whatsappConfig().enabled) return failure("whatsapp_unavailable");
  const phone = typedPhone.safeParse(phoneRaw ?? "");
  if (!phone.success) return failure("validation", { phone: "invalid_phone" });
  const started = await startVerification("reset", null, phone.data);
  return "error" in started ? failure(started.error) : { ok: true, ticket: started.ticket };
}

/** Password recovery by e-mail: limited per device and per address; never says whether an account exists. */
export async function resetWithEmail(client: SupabaseClient, raw: unknown, locale: string): Promise<Failure | { ok: true }> {
  const parsed = emailField.safeParse(raw);
  if (!parsed.success) return failure("validation", { email: "invalid_email" });
  if (!(await count(await buckets(["resetDevice"], [["resetAccount", parsed.data]])))) return failure("too_many_attempts");
  const { error } = await client.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/${locale}/reset-password`,
  });
  if (error) {
    const code = emailDeliveryError(error) ?? (error.status === 429 ? "rate_limited" : "email_send_failed");
    return failure(reportDelivery(code === "resend_too_soon" ? "rate_limited" : code, error.status));
  }
  return { ok: true };
}

/** An e-mailed code (a new account's, or a password reset's), with the limits on guessing. The session lands in `client`. */
export async function verifyEmailCode(client: SupabaseClient, address: string, codeRaw: unknown, type: "email" | "recovery"): Promise<Failure | { ok: true }> {
  const token = String(codeRaw ?? "").replace(/\s/g, "");
  if (!/^[0-9]{6,10}$/.test(token)) return failure("validation", { code: "invalid_code" });
  const limits = await buckets(["signinDevice"], [["codeAccount", address]]);
  if (!(await allowed(limits, address))) return failure("too_many_attempts");
  const { error } = await client.auth.verifyOtp({ email: address, token, type });
  if (error) {
    if (error.status !== 429) {
      logger.warn("email_code_failed", { account: accountTag(address) });
      await countFailure(limits, address);
    }
    return failure(error.status === 429 ? "rate_limited" : "invalid_code");
  }
  return { ok: true };
}

export type VerificationState =
  | { state: "pending" }
  | { state: "expired" | "phone_taken" | "no_account" | "missing" }
  | { state: "verified"; purpose: string; email: string };

/** Where a WhatsApp verification stands; once verified, it is consumed (once) and says whose account it proves. */
export async function verificationState(ticket: string): Promise<VerificationState> {
  const admin = createAdminClient();
  if (!admin) return { state: "missing" };
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
  return { state: "verified", purpose: account.purpose, email: account.email };
}

/** The code to send, and where (the verification's waiting screen). */
export async function verificationCode(ticket: string): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin.rpc("phone_verify_lookup", { p_ticket_hash: hashTicket(ticket) });
  return data?.[0]?.code ?? null;
}

/** A session for the account a verification proved (a one-time sign-in link, used at once, never sent). */
export async function openSession(client: SupabaseClient, email: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) {
    logger.error("phone_verify_session_failed", { status: link.error?.status });
    return false;
  }
  const { error } = await client.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error) {
    logger.error("phone_verify_session_failed", { status: error.status });
    return false;
  }
  return true;
}

/** A new password for the signed-in member, recorded (who and when, never the password). */
export async function setNewPassword(client: SupabaseClient, raw: { password: unknown; confirm: unknown }): Promise<Failure | { ok: true }> {
  const parsed = z
    .object({ password: passwordField, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "passwords_mismatch", path: ["confirm"] })
    .safeParse(raw);
  if (!parsed.success) return failure("validation", zodFieldErrors(parsed.error));
  const { data: user } = await client.auth.getUser();
  if (!user.user) return failure("reset_link_expired");
  const { error } = await client.auth.updateUser({ password: parsed.data.password });
  if (error) return failure(authErrorCode(error));
  logger.info("password_changed", { user: user.user.id });
  const admin = createAdminClient();
  if (admin) {
    const { error: auditError } = await admin.rpc("security_event", { p_action: "password_changed", p_user: user.user.id });
    if (auditError) logger.warn("security_event_failed", { code: auditError.code });
  }
  return { ok: true };
}
