import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The phone app's endpoints answer JSON: the error code and the field it concerns, or what comes next. */
export function appFailure(result: { code: string; fields?: Record<string, string> }) {
  const [name, error] = Object.entries(result.fields ?? {})[0] ?? [];
  return NextResponse.json({ error: result.code, field: name ? { name, error } : null }, { status: result.code === "too_many_attempts" ? 429 : 400 });
}

/** The session a sign-in client now holds, for the app to keep. */
export async function appSession(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  return data.session ? { accessToken: data.session.access_token, refreshToken: data.session.refresh_token } : null;
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  return ((await request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}
