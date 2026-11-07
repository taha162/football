import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Limits on sign-in, sign-up, password resets and e-mail codes, per device
 * (IP address) and per account. The site calls Supabase Auth from its server,
 * so Supabase sees the server's address for everyone; these limits are kept
 * in the database instead (public.auth_throttle, migration 0021), and admins
 * can change each one under Administration > Settings.
 */
const LIMITS = {
  signinDevice: { setting: "auth.signin_failures_per_device", default: 50, window: 15 * 60 },
  signinAccount: { setting: "auth.signin_failures_per_account", default: 10, window: 15 * 60 },
  signupDevice: { setting: "auth.signups_per_device", default: 20, window: 60 * 60 },
  resetDevice: { setting: "auth.resets_per_device", default: 10, window: 60 * 60 },
  resetAccount: { setting: "auth.resets_per_account", default: 5, window: 60 * 60 },
  codeAccount: { setting: "auth.code_failures_per_account", default: 10, window: 15 * 60 },
  resendAccount: { setting: "auth.code_resends_per_account", default: 5, window: 60 * 60 },
} as const;

export type LimitName = keyof typeof LIMITS;
export type Bucket = { key: string; setting: string; default: number; window: number };

/** The visitor's address as the host saw it (Vercel sets these headers itself; a visitor can't). */
async function visitorAddress(): Promise<string | null> {
  const ip = clientIp(await headers());
  // The same machine (development and tests) isn't limited by address; accounts still are.
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return null;
  return ip;
}

/** A keyed hash: the database never holds the address or the e-mail itself. */
function hashed(name: LimitName, value: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return `${name}:${createHmac("sha256", secret).update(value.trim().toLowerCase()).digest("base64url")}`;
}

/** The limits for this request: per device (when the address is known) and per account. */
export async function buckets(device: LimitName[], accounts: Array<[LimitName, string]> = []): Promise<Bucket[]> {
  const ip = device.length ? await visitorAddress() : null;
  const list: Array<[LimitName, string]> = [...(ip ? device.map((name) => [name, ip] as [LimitName, string]) : []), ...accounts];
  return list.map(([name, value]) => ({ key: hashed(name, value), ...LIMITS[name] }));
}

async function ask(list: Bucket[], record: boolean): Promise<boolean> {
  if (list.length === 0) return true;
  const admin = createAdminClient();
  if (!admin) return true;
  const { data, error } = await admin.rpc("auth_throttle", { p_buckets: list, p_record: record });
  if (error) {
    // A database without the update (0021) or briefly out of reach: let people in rather than lock everyone out.
    logger.warn("auth_throttle_unavailable", { message: error.message });
    return true;
  }
  return data !== false;
}

/** Whether the attempt may go ahead, without counting it (to count failures only, with `count`). */
export const allowed = (list: Bucket[]) => ask(list, false);

/** Counts the attempt; false when a limit had already been reached (and nothing was counted). */
export const count = (list: Bucket[]) => ask(list, true);
