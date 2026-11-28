import { NextResponse, type NextRequest } from "next/server";
import { hasSecondFactor } from "@/lib/second-factor";
import { appSignInClient } from "@/lib/supabase/app-token";
import { passwordSignIn } from "@/server/sign-in-core";

export const dynamic = "force-dynamic";

/**
 * The phone app's sign-in: the WhatsApp number (or the e-mail) and the
 * password, with the site's own limits and logging (server/sign-in-core.ts).
 * Answers the session for the app to keep; `secondStep` when the member has an
 * authenticator app, whose code the app then sends to Supabase itself.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown; email?: unknown; password?: unknown } | null;
  const field = typeof body?.phone === "string" ? "phone" : "email";
  const login = String((field === "phone" ? body?.phone : body?.email) ?? "").trim();
  const client = appSignInClient();
  const result = await passwordSignIn(client, field, login, typeof body?.password === "string" ? body.password : "");
  if (!result.ok) return NextResponse.json({ error: result.code, field: result.field ?? null }, { status: result.code === "too_many_attempts" ? 429 : 400 });
  const { data } = await client.auth.getSession();
  if (!data.session) return NextResponse.json({ error: "generic" }, { status: 500 });
  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    secondStep: hasSecondFactor(result.user),
  });
}
