import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";

/**
 * Pieces shared by the phone verification flows (sign-up and password reset
 * with Telegram): the code the user takes to the bot, and the browser's
 * ticket that identifies the verification (only its hash is stored).
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
