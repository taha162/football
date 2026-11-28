"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, type ActionState } from "@/lib/actions";
import { getCurrentUser } from "@/lib/auth";
import { authErrorCode, emailDeliveryError } from "@/lib/auth-errors";
import { logger } from "@/lib/log";
import { DELETE_WORD } from "@/lib/member-deletion";
import { passwordMatches } from "@/lib/password-check";
import { isPhoneAccountEmail, normalizePhone } from "@/lib/phone";
import { createVerification } from "@/lib/phone-verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { accountTag, allowed, buckets, count, countFailure } from "@/lib/throttle";
import { whatsappConfig } from "@/lib/whatsapp";
import { memberVideoFiles, removeMemberFiles, type MemberFiles } from "@/server/member-files";

/**
 * Adding or changing the account's e-mail or phone number (settings). Both ask
 * for the password first: a session left open somewhere is not enough to move
 * the account to someone else's address. Then the new address proves itself:
 * a code e-mailed to it, or a code sent from the number's WhatsApp (as at
 * sign-up). The member is notified either way (migration 0047).
 */

const emailField = z.string().trim().toLowerCase().email("invalid_email").max(254);

/** Which code an e-mail change still waits for, when Supabase asks for both (its «Secure email change»). */
const STEP_COOKIE = "malaab_email_change_left";

async function goTo(href: string) {
  const l = await getLocale();
  redirect({ href, locale: isLocale(l) ? l : "ar" });
}

/** The password, checked with the sign-in limits: wrong guesses here count like wrong sign-ins. */
async function checkPassword(accountEmail: string, fd: FormData): Promise<ActionState | null> {
  const password = String(fd.get("current_password") ?? "");
  if (!password) return fail("validation", { current_password: "required" });
  const limits = await buckets(["signinDevice"], [["signinAccount", accountEmail]]);
  if (!(await allowed(limits, accountEmail))) return fail("too_many_attempts");
  if (await passwordMatches(accountEmail, password)) return null;
  logger.warn("account_change_wrong_password", { account: accountTag(accountEmail) });
  await countFailure(limits, accountEmail);
  return fail("validation", { current_password: "wrong_password" });
}

/** Phone: the number typed, then the code from that number's WhatsApp (the waiting page). */
export async function startPhoneChangeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user?.email) return fail("not_authenticated");
  if (!whatsappConfig().enabled) return fail("whatsapp_unavailable");
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (!phone) return fail("validation", { phone: "invalid_phone" });
  const wrong = await checkPassword(user.email, fd);
  if (wrong) return wrong;
  const failure = await createVerification("phone_change", user.id, phone);
  if (failure) return fail(failure === "same_phone" ? "validation" : failure, failure === "same_phone" ? { phone: "same_phone" } : undefined);
  await goTo("/verify-whatsapp");
  return ok();
}

/** E-mail, step one: Supabase e-mails a code to the new address (and to the old one, if it asks for both). */
export async function startEmailChangeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user?.email) return fail("not_authenticated");
  const parsed = emailField.safeParse(fd.get("email"));
  if (!parsed.success) return fail("validation", { email: "invalid_email" });
  if (parsed.data === user.email.toLowerCase()) return fail("validation", { email: "same_email" });
  const wrong = await checkPassword(user.email, fd);
  if (wrong) return wrong;
  // Codes e-mailed: limited per account, so nobody's inbox can be flooded.
  if (!(await count(await buckets([], [["resendAccount", user.id]])))) return fail("too_many_attempts");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: parsed.data });
  if (error) {
    const code = authErrorCode(error);
    if (emailDeliveryError(error)) logger.error("email_change_send_failed", { status: error.status, code: error.code });
    return fail(code === "invalid_credentials" ? "auth_failed" : code);
  }
  (await cookies()).delete(STEP_COOKIE);
  revalidatePath("/[locale]/settings", "page");
  return ok("email_code_sent");
}

/** E-mail: the code again (a new one, to the same new address). */
export async function resendEmailChangeAction(): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return fail("not_authenticated");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const pending = data.user?.new_email;
  if (!pending) return fail("no_email_change");
  if (!(await count(await buckets([], [["resendAccount", user.id]])))) return fail("too_many_attempts");
  const { error } = await supabase.auth.updateUser({ email: pending });
  if (error) return fail(authErrorCode(error));
  (await cookies()).delete(STEP_COOKIE);
  return ok("code_sent");
}

/**
 * E-mail, step two: the code. Supabase changes the address once the new one
 * is confirmed, or, when it asks for both, once the old one is too: the page
 * then asks for the code sent there. An account made with WhatsApp has only an
 * internal address that receives nothing, so the new address's code is enough.
 */
export async function confirmEmailChangeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return fail("not_authenticated");
  const token = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^[0-9]{6,10}$/.test(token)) return fail("validation", { code: "invalid_code" });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const current = auth.user?.email ?? "";
  const pending = auth.user?.new_email;
  if (!pending) return fail("no_email_change");
  // Guessing codes: limited per account and per device.
  const limits = await buckets(["signinDevice"], [["codeAccount", user.id]]);
  if (!(await allowed(limits, current))) return fail("too_many_attempts");
  const jar = await cookies();
  const left = jar.get(STEP_COOKIE)?.value === "current" ? "current" : "new";
  // The code typed is for the address still waiting; the other one is tried too (either order works).
  const tries = left === "current" ? [current, pending] : isPhoneAccountEmail(current) ? [pending] : [pending, current];
  let verified: { email?: string | null } | null = null;
  let usedFor: string | null = null;
  for (const address of tries) {
    const { data, error } = await supabase.auth.verifyOtp({ email: address, token, type: "email_change" });
    if (!error) {
      verified = data.user ?? {};
      usedFor = address;
      break;
    }
    if (error.status === 429) return fail("rate_limited");
  }
  if (!verified) {
    logger.warn("email_change_code_failed", { account: accountTag(user.id) });
    await countFailure(limits, current);
    return fail("invalid_code");
  }
  let done = verified.email?.toLowerCase() === pending.toLowerCase();
  if (!done && isPhoneAccountEmail(current)) {
    // Supabase also wants the internal address's code, which nobody can receive: the new address
    // is proven by its own code, so the change is finished here.
    const admin = createAdminClient();
    const { data: fresh } = admin ? await admin.auth.admin.getUserById(user.id) : { data: null };
    if (admin && fresh?.user?.new_email?.toLowerCase() === pending.toLowerCase()) {
      const { error } = await admin.auth.admin.updateUserById(user.id, { email: pending, email_confirm: true });
      if (error) {
        logger.error("email_change_finish_failed", { status: error.status });
        return fail(authErrorCode(error));
      }
      done = true;
    }
  }
  if (!done) {
    // Supabase waits for the other address's code too.
    jar.set(STEP_COOKIE, usedFor === pending ? "current" : "new", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 });
    revalidatePath("/[locale]/settings", "page");
    return ok("email_code_other");
  }
  jar.delete(STEP_COOKIE);
  const { error: noteError } = (await createAdminClient()?.rpc("account_email_changed", { p_user_id: user.id, p_email: pending })) ?? { error: null };
  if (noteError) logger.warn("email_change_note_failed", { code: noteError.code });
  revalidatePath("/[locale]", "layout");
  // The form that asked for the code is gone once the address changed: the page says it instead.
  await goTo("/settings?email=changed#email");
  return ok("email_changed");
}

/**
 * Deleting one's own account (Settings → «حذف الحساب»; migration 0050). Asked
 * for: the word «حذف» and the password. The password is checked here (with the
 * sign-in limits); the server key then allows one deletion for 5 minutes, and
 * the deletion itself runs as the member, so the database also asks for the
 * second step when they have one, and refuses an admin of the site or a
 * venue's owner. Their files are then removed, and they are signed out.
 */
export async function deleteMyAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user?.email) return fail("not_authenticated");
  if (String(fd.get("confirm") ?? "").trim() !== DELETE_WORD) return fail("validation", { confirm: "delete_word" });
  const supabase = await createClient();
  // What stops it is said before the password is even checked (the database checks again).
  const { data: preview, error: previewError } = await supabase.rpc("my_account_deletion_preview");
  if (previewError) return fail(dbErrorCode(previewError, "my_account_deletion_preview"));
  const blockers = (preview ?? {}) as { admin?: boolean; owns_venues?: string[] };
  if (blockers.admin) return fail("admin_account");
  if (blockers.owns_venues?.length) return fail("owns_venue");
  const wrong = await checkPassword(user.email, fd);
  if (wrong) return wrong;
  const service = createAdminClient();
  if (!service) {
    logger.error("account_delete_failed", { hint: "SUPABASE_SERVICE_ROLE_KEY is not set" });
    return fail("generic");
  }
  const { error: allowError } = await service.rpc("allow_account_deletion", { p_user_id: user.id });
  if (allowError) return fail(dbErrorCode(allowError, "allow_account_deletion"));
  // Their videos (and stills): read first, as the deletion takes their messages with it.
  const videos = await memberVideoFiles(user.id);
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  const { data, error } = await supabase.rpc("delete_my_account", { p_reason: reason || undefined });
  if (error) return fail(dbErrorCode(error, "delete_my_account"));
  const left = await removeMemberFiles(((data ?? {}) as { files?: MemberFiles }).files ?? {}, videos);
  logger.info("account_self_deleted", { user: user.id, files_left: left });
  if (left > 0) logger.error("account_files_left", { user: user.id, count: left });
  // The account is gone: this clears the session cookies whatever the server answers.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  await goTo("/sign-in?account=deleted");
  return ok("account_deleted");
}
