import { clientIp } from "@/lib/client-ip";

/**
 * Per-address limits for the API routes (/api/*, /auth/callback).
 *
 * They count in this server's memory. Vercel can run several copies of the
 * site, so a flood from one address is stopped on each copy, not counted
 * exactly across all of them; Vercel's Firewall can add an exact rule in
 * front (DEPLOYMENT.md). Sign-in, sign-up, password resets and codes have
 * their own exact limits in the database (src/lib/throttle.ts).
 */
export type Limit = { name: string; max: number; windowSeconds: number };

export const API_LIMITS = {
  health: { name: "health", max: 60, windowSeconds: 60 },
  calendar: { name: "calendar", max: 60, windowSeconds: 60 },
  // Each page load with live updates asks once, then about once an hour; people can share an address.
  session: { name: "session", max: 300, windowSeconds: 60 },
  authCallback: { name: "auth_callback", max: 30, windowSeconds: 60 },
  // Requests without the right secret (cron, WhatsApp webhook): the real callers always have it.
  badSecret: { name: "bad_secret", max: 10, windowSeconds: 60 },
} as const satisfies Record<string, Limit>;

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
let lastSweep = 0;

function current(limit: Limit, address: string, now: number): Window {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  const key = `${limit.name}:${address}`;
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + limit.windowSeconds * 1000 };
    windows.set(key, w);
  }
  return w;
}

/**
 * Counts one request from `address`. `ok` is false once the limit is used up,
 * with the seconds until it frees up. No address (this machine, in
 * development and tests): not limited.
 */
export function hit(limit: Limit, address: string | null, now = Date.now()): { ok: boolean; retryAfter: number } {
  if (!address) return { ok: true, retryAfter: 0 };
  const w = current(limit, address, now);
  if (w.count >= limit.max) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  w.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** Whether `address` has used up `limit`, without counting (to count only failures with `hit`). */
export function spent(limit: Limit, address: string | null, now = Date.now()): { ok: boolean; retryAfter: number } {
  if (!address) return { ok: true, retryAfter: 0 };
  const w = current(limit, address, now);
  return w.count >= limit.max ? { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) } : { ok: true, retryAfter: 0 };
}

/** The address limits count by; null for this machine (development and tests send no outside address). */
export function limitAddress(headers: Pick<Headers, "get">): string | null {
  const ip = clientIp(headers);
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return null;
  return ip;
}

/** The answer once a limit is used up. */
export function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "too_many_requests" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}

/** For tests: forget every count. */
export function resetLimits() {
  windows.clear();
}
