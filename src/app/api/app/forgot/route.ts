import { NextResponse, type NextRequest } from "next/server";
import { appFailure, body } from "@/lib/app-api";
import { whatsappStep } from "@/lib/app-whatsapp";
import { appSignInClient } from "@/lib/supabase/app-token";
import { resetWithEmail, resetWithWhatsapp } from "@/server/signup-core";

export const dynamic = "force-dynamic";

/** The phone app: a forgotten password, by the account's WhatsApp number or its e-mail (a code is e-mailed). */
export async function POST(request: NextRequest) {
  const b = await body(request);
  if (b.phone !== undefined) {
    const result = await resetWithWhatsapp(b.phone);
    return result.ok ? NextResponse.json(await whatsappStep(result.ticket)) : appFailure(result);
  }
  const result = await resetWithEmail(appSignInClient(), b.email, "ar");
  // Never says whether an account exists: the same answer either way.
  return result.ok ? NextResponse.json({ next: "email_code" }) : appFailure(result);
}
