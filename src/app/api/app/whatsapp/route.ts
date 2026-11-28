import { NextResponse, type NextRequest } from "next/server";
import { appSession, body } from "@/lib/app-api";
import { appSignInClient } from "@/lib/supabase/app-token";
import { openSession, verificationState } from "@/server/signup-core";

export const dynamic = "force-dynamic";

/**
 * The phone app's waiting screen asks here whether the code arrived from the
 * number's WhatsApp. Once it has, the account's session (one-time) and what
 * comes next: onboarding after a sign-up, a new password after a reset.
 */
export async function POST(request: NextRequest) {
  const b = await body(request);
  const ticket = typeof b.ticket === "string" && /^[A-Za-z0-9_-]{43}$/.test(b.ticket) ? b.ticket : null;
  if (!ticket) return NextResponse.json({ state: "missing" });
  const result = await verificationState(ticket);
  if (result.state !== "verified") return NextResponse.json(result);
  if (result.purpose === "phone_change") return NextResponse.json({ state: "done", next: "settings" });
  const client = appSignInClient();
  if (!(await openSession(client, result.email))) return NextResponse.json({ state: "missing" });
  return NextResponse.json({ state: "done", next: result.purpose === "signup" ? "onboarding" : "new_password", ...(await appSession(client)) });
}
