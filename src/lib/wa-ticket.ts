import "server-only";
import { cookies, headers } from "next/headers";

/** Browser-side handle of a WhatsApp verification (only its hash is stored). */
const WA_TICKET_COOKIE = "malaab_wa_ticket";

export async function setWaTicket(ticket: string) {
  (await cookies()).set(WA_TICKET_COOKIE, ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 60,
  });
}

export async function getWaTicket(): Promise<string | null> {
  const value = (await cookies()).get(WA_TICKET_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export async function clearWaTicket() {
  (await cookies()).delete(WA_TICKET_COOKIE);
}

/** Client identifier for rate limiting (hashed in the database, never stored raw). */
export async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}
