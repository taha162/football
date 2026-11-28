import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { authErrorCode } from "@/lib/auth-errors";
import { logger } from "@/lib/log";
import { looksLikePhone, normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountTag, allowed, buckets, countFailure } from "@/lib/throttle";

const email = z.string().trim().toLowerCase().email("invalid_email").max(254);

export type PasswordSignIn =
  | { ok: true; user: User; address: string }
  | { ok: false; code: string; field?: { name: "phone" | "email" | "password"; error: string }; address?: string };

/**
 * Signing in with the WhatsApp number (or the e-mail) and the password, with
 * the site's limits: too many wrong passwords from a device or on an account
 * stop the guessing for a while, and each failure is logged with a tag that
 * can't be read back to the number or address. The session lands in `client`:
 * the site's cookies (sign-in page), or a client that hands the tokens to the
 * phone app (/api/app/sign-in).
 */
export async function passwordSignIn(client: SupabaseClient, field: "phone" | "email", login: string, password: string): Promise<PasswordSignIn> {
  if (!password) return { ok: false, code: "validation", field: { name: "password", error: "required" } };
  let address: string | null = null;
  let account: string;
  if (field === "phone" || looksLikePhone(login)) {
    const phone = normalizePhone(login);
    if (!phone) return { ok: false, code: "validation", field: { name: field, error: "invalid_phone" } };
    account = phone;
  } else {
    const parsed = email.safeParse(login);
    if (!parsed.success) return { ok: false, code: "validation", field: { name: "email", error: "invalid_email" } };
    account = address = parsed.data;
  }
  const limits = await buckets(["signinDevice"], [["signinAccount", account]]);
  if (!(await allowed(limits, account))) return { ok: false, code: "too_many_attempts" };
  const via = address ? "email" : "phone";
  if (!address) {
    // Phone sign-in: the number's account has an auth address of its own.
    const admin = createAdminClient();
    const { data } = admin ? await admin.rpc("auth_email_for_phone", { p_phone: account }) : { data: null };
    if (!data) {
      logger.warn("sign_in_failed", { via, account: accountTag(account) });
      await countFailure(limits, account);
      return { ok: false, code: "invalid_phone_credentials" };
    }
    address = data as string;
  }
  const { data, error } = await client.auth.signInWithPassword({ email: address, password });
  if (error) {
    const code = authErrorCode(error);
    if (code === "invalid_credentials") {
      logger.warn("sign_in_failed", { via, account: accountTag(account) });
      await countFailure(limits, account);
      if (via === "phone") return { ok: false, code: "invalid_phone_credentials" };
    }
    return { ok: false, code, address };
  }
  return { ok: true, user: data.user, address };
}
