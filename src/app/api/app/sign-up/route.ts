import { NextResponse, type NextRequest } from "next/server";
import { appFailure, appSession, body } from "@/lib/app-api";
import { whatsappStep } from "@/lib/app-whatsapp";
import { appSignInClient } from "@/lib/supabase/app-token";
import { signUpWithEmail, signUpWithWhatsapp } from "@/server/signup-core";

export const dynamic = "force-dynamic";

/**
 * The phone app's sign-up (server/signup-core.ts, as the site's): by WhatsApp
 * number (then the code from that number's WhatsApp) or by e-mail (then the
 * e-mailed code).
 */
export async function POST(request: NextRequest) {
  const b = await body(request);
  const raw = { ...b, accept_terms: b.accept_terms === true ? "on" : undefined };
  if (b.method === "whatsapp") {
    const result = await signUpWithWhatsapp(raw, "ar");
    return result.ok ? NextResponse.json(await whatsappStep(result.ticket)) : appFailure(result);
  }
  const client = appSignInClient();
  const result = await signUpWithEmail(client, raw, "ar");
  if (!result.ok) return appFailure(result);
  if (!result.session) return NextResponse.json({ next: "email_code", email: result.email });
  return NextResponse.json({ next: "signed_in", ...(await appSession(client)) });
}
