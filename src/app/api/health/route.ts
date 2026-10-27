import { NextResponse } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness + dependency check. Exposes no secrets or internal details. */
export async function GET() {
  const checks: Record<string, "ok" | "unconfigured" | "error"> = { app: "ok", database: "unconfigured" };
  if (isSupabaseConfigured()) {
    try {
      const res = await fetch(`${publicEnv.supabaseUrl}/rest/v1/cities?select=id&limit=1`, {
        headers: { apikey: publicEnv.supabaseAnonKey },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      checks.database = res.ok ? "ok" : "error";
    } catch {
      checks.database = "error";
    }
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
