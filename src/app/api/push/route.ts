import { NextResponse, type NextRequest } from "next/server";
import { hasCronSecret } from "@/lib/cron-auth";
import { logger } from "@/lib/log";
import { API_LIMITS, hit, limitAddress, spent, tooManyRequests } from "@/lib/rate-limit";
import { drainPush } from "@/server/push";

export const dynamic = "force-dynamic";

/**
 * The database's wake-up (migration 0051, private.kick_push): something waits
 * in the push queue, send it now. `Authorization: Bearer $CRON_SECRET`, the
 * same secret as the scheduled job (saved in Supabase Vault as push_secret).
 */
export async function POST(request: NextRequest) {
  const address = limitAddress(request.headers);
  const blocked = spent(API_LIMITS.badSecret, address);
  if (!blocked.ok) return tooManyRequests(blocked.retryAfter);
  if (!hasCronSecret(request)) {
    hit(API_LIMITS.badSecret, address);
    logger.warn("push_unauthorized", { withHeader: request.headers.has("authorization") });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await drainPush();
  return NextResponse.json({ ok: true, ...result });
}
