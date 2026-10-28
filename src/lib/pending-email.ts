import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";

/** E-mail waiting for its sign-up code (httpOnly, so the address is not in the URL). */
const PENDING_EMAIL_COOKIE = "malaab_pending_email";
const emailSchema = z.string().email().max(254);

export async function setPendingEmail(value: string) {
  (await cookies()).set(PENDING_EMAIL_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
}

export async function getPendingEmail(): Promise<string | null> {
  const value = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value;
  return value && emailSchema.safeParse(value).success ? value : null;
}

export async function clearPendingEmail() {
  (await cookies()).delete(PENDING_EMAIL_COOKIE);
}
