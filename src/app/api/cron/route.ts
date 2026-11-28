import { NextResponse, type NextRequest } from "next/server";
import { hasCronSecret } from "@/lib/cron-auth";
import { logger } from "@/lib/log";
import { API_LIMITS, hit, limitAddress, spent, tooManyRequests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { MESSAGE_VIDEOS } from "@/lib/message-video";
import { deliverWhatsapp } from "@/lib/whatsapp-outbox";
import { drainPush } from "@/server/push";

export const dynamic = "force-dynamic";


/**
 * Scheduled maintenance: expires stale booking requests, sends match
 * reminders, closes expired listings, auto-completes past matches, hands
 * waiting WhatsApp messages to the bot, and removes chat videos no message
 * points at any more.
 * Call every 15 minutes with `Authorization: Bearer $CRON_SECRET`
 * (e.g. Vercel Cron or any scheduler). Idempotent.
 */
export async function GET(request: NextRequest) {
  // Wrong secrets are limited per address (the scheduler always has the right one).
  const address = limitAddress(request.headers);
  const blocked = spent(API_LIMITS.badSecret, address);
  if (!blocked.ok) return tooManyRequests(blocked.retryAfter);
  if (!hasCronSecret(request)) {
    hit(API_LIMITS.badSecret, address);
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
  // Old notifications and audit entries, past their keeping periods (…0038); missing before that runs.
  const { data: retention, error: retentionError } = await admin.rpc("run_retention_cleanup");
  if (retentionError && retentionError.code !== "PGRST202") logger.error("cron_retention_failed", { code: retentionError.code });
  // Chat videos (and stills) no message points at, a day on: uploads never sent, deleted messages (…0045).
  const { data: orphans, error: orphansError } = await admin.rpc("orphan_message_videos", { p_limit: 500 });
  if (orphansError && orphansError.code !== "PGRST202") logger.error("cron_orphan_videos_failed", { code: orphansError.code });
  const videoNames = (Array.isArray(orphans) ? orphans : []).filter((n): n is string => typeof n === "string");
  let videosRemoved = 0;
  for (let i = 0; i < videoNames.length; i += 100) {
    const chunk = videoNames.slice(i, i + 100);
    const { error: removeError } = await admin.storage.from(MESSAGE_VIDEOS).remove(chunk);
    if (removeError) logger.error("cron_orphan_videos_remove_failed", { message: removeError.message.slice(0, 120) });
    else videosRemoved += chunk.length;
  }
  // Phone notifications still waiting (the database's wake-up isn't set, or failed): migration 0051.
  const push = await drainPush().catch((e: unknown) => {
    logger.error("cron_push_failed", { message: e instanceof Error ? e.message : "unknown" });
    return null;
  });
  const result = {
    ...(data as Record<string, unknown>),
    ...((cleanup as Record<string, unknown>) ?? {}),
    ...((calls as Record<string, unknown>) ?? {}),
    ...((waCleanup as Record<string, unknown>) ?? {}),
    ...(retention ? { retention } : {}),
    ...(videosRemoved ? { videos_removed: videosRemoved } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(push && push.sent + push.gone + push.failed ? { push } : {}),
  };
  logger.info("cron_completed", { ms: Date.now() - started, ...result });
  return NextResponse.json({ ok: true, result });
}
