import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes e-mail links (sign-up confirmation, password recovery, e-mail
 * change). Supports the PKCE `code` flow and the `token_hash` flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"), "/");
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }
  const locale = next.startsWith("/en") ? "en" : "ar";
  return NextResponse.redirect(new URL(ok ? next : `/${locale}/sign-in?error=link_invalid`, origin));
}
