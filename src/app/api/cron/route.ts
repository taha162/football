import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverWhatsapp } from "@/lib/whatsapp-outbox";

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
 * reminders, closes expired listings, auto-completes past matches, and hands
 * waiting WhatsApp messages to the bot.
 * Call every 15 minutes with `Authorization: Bearer $CRON_SECRET`
 * (e.g. Vercel Cron or any scheduler). Idempotent.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    // Someone other than the scheduler, or a scheduler with the wrong secret: worth noticing.
    logger.warn("cron_unauthorized", { withHeader: request.headers.has("authorization") });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "service_role_not_configured" }, { status: 503 });
  const started = Date.now();
  const { data, error } = await admin.rpc("run_scheduled_jobs");
  if (error) {
    logger.error("cron_failed", { code: error.code });
    return NextResponse.json({ error: "job_failed" }, { status: 500 });
  }
  // Abandoned phone sign-ups (never verified) and old verification rows.
  const { data: cleanup, error: cleanupError } = await admin.rpc("phone_verify_cleanup");
  if (cleanupError) logger.error("cron_phone_verify_cleanup_failed", { code: cleanupError.code });
  // Calls both browsers abandoned: recorded as missed (with the notification) or ended.
  const { data: calls, error: callsError } = await admin.rpc("calls_cleanup");
  if (callsError) logger.error("cron_calls_cleanup_failed", { code: callsError.code });
  // WhatsApp: what the bot reports, then the next booking messages and promotions (does nothing until the bot is set up).
  const whatsapp = await deliverWhatsapp().catch((e: unknown) => {
    logger.error("cron_whatsapp_failed", { message: e instanceof Error ? e.message : "unknown" });
    return null;
  });
  const { data: waCleanup, error: waCleanupError } = await admin.rpc("wa_outbox_cleanup");
  // Before the database update (…0028) the function is missing: not an error worth a page.
  if (waCleanupError && waCleanupError.code !== "PGRST202") logger.error("cron_whatsapp_cleanup_failed", { code: waCleanupError.code });
  const result = {
    ...(data as Record<string, unknown>),
    ...((cleanup as Record<string, unknown>) ?? {}),
    ...((calls as Record<string, unknown>) ?? {}),
    ...((waCleanup as Record<string, unknown>) ?? {}),
    ...(whatsapp ? { whatsapp } : {}),
  };
  logger.info("cron_completed", { ms: Date.now() - started, ...result });
  return NextResponse.json({ ok: true, result });
}
