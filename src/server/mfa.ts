"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { fail, ok, type ActionState } from "@/lib/actions";
import { safeNext } from "@/lib/auth";
import { logger } from "@/lib/log";
import { afterSecondStep } from "@/lib/second-factor";
import { createClient } from "@/lib/supabase/server";
import { allowed, buckets, count } from "@/lib/throttle";

/**
 * Two-step verification with an authenticator app (TOTP, Supabase Auth MFA).
 * Turning it on, the code after the password, and turning it off. The database
 * enforces it (migration 0027): once the app is confirmed, a session that only
 * passed the password can neither read nor change anything as that person.
 */

/** Shown in the authenticator app next to the account. */
const ISSUER = "Al-Malab";

const sixDigits = z
  .string()
  .transform((v) => v.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "app_code"));

async function currentLocale(): Promise<Locale> {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The confirmed authenticator app of the signed-in person, if any. */
async function verifiedFactor(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.totp.find((f) => f.status === "verified")?.id ?? null;
}

/**
 * Checks a code from the app against the given factor; wrong codes count
 * towards the same limits as e-mailed codes (per account, and per device).
 */
async function checkCode(supabase: Supabase, userId: string, factorId: string, code: string): Promise<ActionState | null> {
  const limits = await buckets(["signinDevice"], [["codeAccount", `second-factor:${userId}`]]);
  if (!(await allowed(limits))) return fail("too_many_attempts");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (!error) return null;
  if (error.status === 429) return fail("rate_limited");
  await count(limits);
  return fail("invalid_code");
}

/** Step 1 of turning it on: a new secret, shown as a QR code and as text. */
export async function startSecondFactorAction(): Promise<ActionState<{ factorId: string; qr: string; secret: string }>> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("not_authenticated");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp.some((f) => f.status === "verified")) return fail("second_factor_on");
  // An earlier set-up that was never confirmed: replaced by this one.
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: ISSUER });
  if (error || !data) {
    logger.error("second_factor_enroll_failed", { status: error?.status, code: error?.code });
    return fail("generic");
  }
  // Supabase sends the picture as raw SVG text; base64 keeps characters like "#" from cutting the address short.
  const svg = data.totp.qr_code.replace(/^data:image\/svg\+xml;[^,]*,/, "");
  const qr = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  return ok(undefined, { factorId: data.id, qr, secret: data.totp.secret });
}

/** Step 2 of turning it on: the first code from the app confirms it (and this session passes the second step). */
export async function confirmSecondFactorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const factorId = z.string().uuid().safeParse(fd.get("factor_id"));
  const code = sixDigits.safeParse(fd.get("code") ?? "");
  if (!factorId.success) return fail("invalid");
  if (!code.success) return fail("validation", { code: "app_code" });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("not_authenticated");
  const refused = await checkCode(supabase, auth.user.id, factorId.data, code.data);
  if (refused) return refused;
  logger.info("second_factor_enabled", { user: auth.user.id });
  revalidatePath("/[locale]/settings", "page");
  return ok("second_factor_on");
}

/** After the password: the code from the app completes sign-in. */
export async function verifySecondFactorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = sixDigits.safeParse(fd.get("code") ?? "");
  if (!code.success) return fail("validation", { code: "app_code" });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("not_authenticated");
  const factorId = await verifiedFactor(supabase);
  if (!factorId) return fail("second_factor_off");
  const refused = await checkCode(supabase, auth.user.id, factorId, code.data);
  if (refused) return refused;
  redirect({ href: afterSecondStep(safeNext(fd.get("next"))), locale: await currentLocale() });
  return ok();
}

/** Turning it off takes a current code too, so a session left open somewhere can't do it alone. */
export async function turnOffSecondFactorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = sixDigits.safeParse(fd.get("code") ?? "");
  if (!code.success) return fail("validation", { code: "app_code" });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("not_authenticated");
  const factorId = await verifiedFactor(supabase);
  if (!factorId) return fail("second_factor_off");
  const refused = await checkCode(supabase, auth.user.id, factorId, code.data);
  if (refused) return refused;
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    logger.error("second_factor_unenroll_failed", { status: error.status, code: error.code });
    return fail(error.code === "insufficient_aal" ? "mfa_required" : "generic");
  }
  logger.info("second_factor_disabled", { user: auth.user.id });
  revalidatePath("/[locale]/settings", "page");
  return ok("second_factor_off");
}
