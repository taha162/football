import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { API_LIMITS, hit, limitAddress, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Status = "ok" | "unconfigured" | "error";

/** The database check, shared for a few seconds: a flood of health checks doesn't become a flood of queries. */
let lastCheck: { at: number; database: Status } | null = null;
const CHECK_SECONDS = 10;

async function databaseStatus(): Promise<Status> {
  if (!isSupabaseConfigured()) return "unconfigured";
  if (lastCheck && Date.now() - lastCheck.at < CHECK_SECONDS * 1000) return lastCheck.database;
  let database: Status;
  try {
    const res = await fetch(`${publicEnv.supabaseUrl}/rest/v1/cities?select=id&limit=1`, {
      headers: { apikey: publicEnv.supabaseAnonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    database = res.ok ? "ok" : "error";
  } catch {
    database = "error";
  }
  lastCheck = { at: Date.now(), database };
  return database;
}

/** Liveness + dependency check. Exposes no secrets or internal details. */
export async function GET(request: NextRequest) {
  const limit = hit(API_LIMITS.health, limitAddress(request.headers));
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const checks: Record<string, Status> = { app: "ok", database: await databaseStatus() };
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
