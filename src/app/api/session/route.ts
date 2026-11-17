import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/log";
import { API_LIMITS, hit, limitAddress, tooManyRequests } from "@/lib/rate-limit";
import { sessionTooOld } from "@/lib/session-policy";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, private" };
const none = (status: number) => NextResponse.json({ access_token: null }, { status, headers: noStore });

/**
 * The signed-in person's access token, for the browser's live updates and
 * calls (src/lib/supabase/client.ts). The session cookies are HttpOnly, so
 * the page itself can't read them; this hands out only the access token,
 * which expires within an hour, never the refresh token that keeps a session
 * going.
 *
 * Only the site's own pages may ask: browsers say where a request comes from
 * (Sec-Fetch-Site), and with no CORS headers no other site could read the
 * answer anyway.
 */
export async function GET(request: NextRequest) {
  const from = request.headers.get("sec-fetch-site");
  if (from && from !== "same-origin") return none(403);
  const limit = hit(API_LIMITS.session, limitAddress(request.headers));
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const supabase = await createClient();
  // Checked with Supabase Auth; an expired access token is refreshed first (new cookies on this answer).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return none(401);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return none(401);
  if (sessionTooOld(session.access_token)) {
    // Past the site's session lifetime (src/lib/session-policy.ts): ended at Supabase too.
    await supabase.auth.signOut({ scope: "local" });
    logger.info("session_expired", { user: user.id, via: "api_session" });
    return none(401);
  }
  return NextResponse.json(
    { access_token: session.access_token, expires_at: session.expires_at ?? null, user_id: user.id },
    { headers: noStore },
  );
}
