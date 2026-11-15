import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { dbErrorCode } from "@/lib/actions";
import { clientIp } from "@/lib/client-ip";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pieces shared by the phone verification flows (sign-up and password reset
 * with Telegram or WhatsApp): the code the user takes to the bot, and the
 * browser's ticket that identifies the verification (only its hash is stored).
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** Eight characters from a 31-symbol alphabet (~40 bits), shown as XXXX-XXXX. */
export function newVerificationCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function newTicket(): { ticket: string; hash: string } {
  const ticket = randomBytes(32).toString("base64url");
  return { ticket, hash: hashTicket(ticket) };
}

export function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

const TICKET_COOKIE = "malaab_verify_ticket";

export async function setVerifyTicket(ticket: string) {
  (await cookies()).set(TICKET_COOKIE, ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 60,
  });
}

export async function getVerifyTicket(): Promise<string | null> {
  const value = (await cookies()).get(TICKET_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export async function clearVerifyTicket() {
  (await cookies()).delete(TICKET_COOKIE);
}

/** Client identifier for rate limiting (hashed in the database, never stored raw). */
export async function clientKey(): Promise<string> {
  return clientIp(await headers()) ?? "unknown";
}

/**
 * Starts a verification and keeps its ticket in the browser, retrying on the
 * (unlikely) clash with another pending code. Returns an error code, or null.
 * The same row serves Telegram and WhatsApp: the code is what the user takes
 * to either bot. `phone` (WhatsApp) is the number the user typed: the code is
 * then accepted only from that number.
 */
export async function createVerification(purpose: "signup" | "reset", userId: string | null, phone: string | null = null): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return "generic";
  const key = await clientKey();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { ticket, hash } = newTicket();
    const { error } = await admin.rpc("phone_verify_start", {
      p_purpose: purpose,
      p_code: newVerificationCode(),
      p_ticket_hash: hash,
      // Null for a reset (the generated types don't model nullable arguments).
      p_user_id: userId as string,
      p_client_key: key,
      ...(phone ? { p_phone: phone } : {}),
    });
    if (!error) {
      await setVerifyTicket(ticket);
      return null;
    }
    if (phone && error.code === "PGRST202") {
      // A database without migration 0029 has no typed number: start as before (the sender's
      // number, when WhatsApp shows it, is the verified one). Admin → Settings says to apply 0029.
      logger.warn("phone_verify_start_without_typed_number");
      phone = null;
      continue;
    }
    if (error.code !== "23505") return dbErrorCode(error, "phone_verify_start");
  }
  return "generic";
}
