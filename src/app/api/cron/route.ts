import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Scheduled maintenance: expires stale booking requests, sends match
 * reminders, closes expired listings, auto-completes past matches.
 * Call every 15 minutes with `Authorization: Bearer $CRON_SECRET`
 * (e.g. Vercel Cron or any scheduler). Idempotent.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "service_role_not_configured" }, { status: 503 });
  const started = Date.now();
  const { data, error } = await admin.rpc("run_scheduled_jobs");
  if (error) {
    logger.error("cron_failed", { code: error.code });
    return NextResponse.json({ error: "job_failed" }, { status: 500 });
  }
  logger.info("cron_completed", { ms: Date.now() - started, ...(data as Record<string, unknown>) });
  return NextResponse.json({ ok: true, result: data });
}
