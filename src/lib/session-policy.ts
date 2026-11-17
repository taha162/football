/**
 * How long a sign-in lasts (SECURITY.md, "Sessions").
 *
 * - At most 30 days after signing in, whatever happens: then the person signs
 *   in again. The proxy (pages and actions) and /api/session (the browser's
 *   live connection) both end such a session at Supabase.
 * - 7 days without a visit: the session cookies are written with this
 *   lifetime and rewritten while the site is used, so a browser left alone
 *   for a week drops them.
 *
 * Supabase Auth can do the same itself (session time-box and inactivity
 * timeout), but only on paid plans; these limits work on any plan.
 */
export const SESSION_MAX_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60;

function base64UrlJson(part: string): unknown {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * When the session behind this access token signed in, in seconds since 1970:
 * the earliest method in the token's `amr` claim. Supabase keeps those times
 * when it refreshes the token (unlike `iat`). Null when the token says nothing.
 * The token itself is checked by Supabase (getUser) before this is trusted.
 */
export function sessionStartedAt(accessToken: string): number | null {
  try {
    const claims = base64UrlJson(accessToken.split(".")[1] ?? "") as { amr?: Array<{ timestamp?: unknown }> };
    const times = (Array.isArray(claims.amr) ? claims.amr : [])
      .map((m) => m?.timestamp)
      .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    return times.length ? Math.min(...times) : null;
  } catch {
    return null;
  }
}

/** True when the session signed in longer ago than the site allows (SESSION_MAX_SECONDS). */
export function sessionTooOld(accessToken: string | null | undefined, nowSeconds = Date.now() / 1000): boolean {
  if (!accessToken) return false;
  const started = sessionStartedAt(accessToken);
  return started !== null && nowSeconds - started > SESSION_MAX_SECONDS;
}
