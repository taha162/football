import { NextResponse, type NextRequest } from "next/server";
import { appFailure, appSession, body } from "@/lib/app-api";
import { emailDeliveryError } from "@/lib/auth-errors";
import { appSignInClient } from "@/lib/supabase/app-token";
import { buckets, count } from "@/lib/throttle";
import { emailField, reportDelivery, verifyEmailCode } from "@/server/signup-core";

export const dynamic = "force-dynamic";

/**
 * The phone app: an e-mailed code (a new account's, or a password reset's),
 * with the site's limits on guessing; answers the session. `resend: true`
 * sends a new sign-up code instead (limited per address).
 */
export async function POST(request: NextRequest) {
  const b = await body(request);
  const address = emailField.safeParse(b.email);
  if (!address.success) return appFailure({ code: "validation", fields: { email: "invalid_email" } });
  const client = appSignInClient();
  if (b.resend === true) {
    if (!(await count(await buckets([], [["resendAccount", address.data]])))) return appFailure({ code: "too_many_attempts" });
    const { error } = await client.auth.resend({ type: "signup", email: address.data });
    if (error) return appFailure({ code: reportDelivery(emailDeliveryError(error) ?? (error.status === 429 ? "rate_limited" : "email_send_failed"), error.status) });
    return NextResponse.json({ ok: true });
  }
  const result = await verifyEmailCode(client, address.data, b.code, b.purpose === "recovery" ? "recovery" : "email");
  if (!result.ok) return appFailure(result);
  return NextResponse.json({ next: b.purpose === "recovery" ? "new_password" : "onboarding", ...(await appSession(client)) });
}
