import { NextResponse, type NextRequest } from "next/server";
import { appFailure, body } from "@/lib/app-api";
import { appSignInClient } from "@/lib/supabase/app-token";
import { setNewPassword } from "@/server/signup-core";

export const dynamic = "force-dynamic";

/** The phone app: a new password for the member (after a reset), recorded as on the site. */
export async function POST(request: NextRequest) {
  const b = await body(request);
  const client = appSignInClient();
  const { error } = await client.auth.setSession({ access_token: String(b.accessToken ?? ""), refresh_token: String(b.refreshToken ?? "") });
  if (error) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const result = await setNewPassword(client, { password: b.password, confirm: b.confirm });
  return result.ok ? NextResponse.json({ ok: true }) : appFailure(result);
}
