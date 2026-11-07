/**
 * The visitor's address, for per-device limits. `x-real-ip` comes first: the
 * host (Vercel) sets it itself, and a visitor can't. The first hop of
 * `x-forwarded-for` is only a fallback, because behind a proxy that appends
 * rather than replaces that header, the first hop is whatever the visitor
 * wrote. Deployed anywhere but Vercel, make sure the proxy sets x-real-ip.
 */
export function clientIp(h: Pick<Headers, "get">): string | null {
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
