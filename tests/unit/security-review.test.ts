import { beforeEach, describe, expect, it } from "vitest";
import { maskAccount } from "@/lib/account-mask";
import { API_LIMITS, hit, limitAddress, resetLimits, spent } from "@/lib/rate-limit";
import { isSensitivePath } from "@/lib/sensitive-paths";
import { SESSION_IDLE_SECONDS, SESSION_MAX_SECONDS, sessionStartedAt, sessionTooOld } from "@/lib/session-policy";

/** A token-shaped string with these claims (only the payload is read; Supabase checks the signature). */
const token = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const DAY = 24 * 60 * 60;

describe("session lifetime", () => {
  it("is 30 days at most, and the cookies lapse after 7 days without a visit", () => {
    expect(SESSION_MAX_SECONDS).toBe(30 * DAY);
    expect(SESSION_IDLE_SECONDS).toBe(7 * DAY);
  });

  it("reads when the session signed in: the earliest method in amr (kept across refreshes, unlike iat)", () => {
    expect(sessionStartedAt(token({ iat: 2_000_000, amr: [{ method: "totp", timestamp: 1_000_500 }, { method: "password", timestamp: 1_000_000 }] }))).toBe(1_000_000);
    expect(sessionStartedAt(token({ iat: 2_000_000 }))).toBeNull();
    expect(sessionStartedAt("not-a-token")).toBeNull();
  });

  it("a session signed in over 30 days ago is too old; younger ones, and tokens that don't say, are not", () => {
    const now = 1_800_000_000;
    expect(sessionTooOld(token({ amr: [{ method: "password", timestamp: now - 30 * DAY - 1 }] }), now)).toBe(true);
    expect(sessionTooOld(token({ amr: [{ method: "otp", timestamp: now - 29 * DAY }] }), now)).toBe(false);
    expect(sessionTooOld(token({ iat: now - 90 * DAY }), now)).toBe(false);
    expect(sessionTooOld(null, now)).toBe(false);
  });
});

describe("files that must never be served (answered 404 by the proxy)", () => {
  it.each([
    "/.env",
    "/.env.local",
    "/ar/.env",
    "/.git/config",
    "/.git/HEAD",
    "/ar/.git/config",
    "/.DS_Store",
    "/backup.sql",
    "/db/dump.sql.gz",
    "/site.zip",
    "/database.sqlite3",
    "/server.log",
    "/supabase/config.toml",
    "/pnpm-lock.yaml",
    "/private.pem",
    "/%2eenv",
    "/config.yml~",
  ])("%s", (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each(["/", "/ar", "/ar/venues", "/ar/matches/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", "/_next/static/chunks/main-abc123.js", "/icon.svg", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/.well-known/security.txt", "/ar/blog"])(
    "%s is served as usual",
    (path) => {
      expect(isSensitivePath(path)).toBe(false);
    },
  );
});

describe("API rate limits", () => {
  beforeEach(resetLimits);
  const limit = { name: "test", max: 3, windowSeconds: 60 };

  it("counts per address within the window, then refuses with the seconds left", () => {
    const t = 1_000_000;
    expect([1, 2, 3].map(() => hit(limit, "203.0.113.9", t).ok)).toEqual([true, true, true]);
    expect(hit(limit, "203.0.113.9", t + 1_000)).toEqual({ ok: false, retryAfter: 59 });
    // Another address has its own count; the next window starts afresh.
    expect(hit(limit, "198.51.100.7", t).ok).toBe(true);
    expect(hit(limit, "203.0.113.9", t + 60_000).ok).toBe(true);
  });

  it("spent() only looks, so failures alone can be counted", () => {
    const t = 2_000_000;
    expect(spent(limit, "203.0.113.9", t).ok).toBe(true);
    for (let i = 0; i < 3; i++) hit(limit, "203.0.113.9", t);
    expect(spent(limit, "203.0.113.9", t).ok).toBe(false);
  });

  it("doesn't limit this machine (development and tests), and reads the address as the sign-in limits do", () => {
    for (let i = 0; i < 10; i++) expect(hit(limit, null).ok).toBe(true);
    expect(limitAddress(new Headers({ "x-real-ip": "127.0.0.1" }))).toBeNull();
    expect(limitAddress(new Headers({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" }))).toBe("198.51.100.7");
  });

  it("has a limit for every API route", () => {
    expect(Object.keys(API_LIMITS).sort()).toEqual(["authCallback", "badSecret", "calendar", "health", "session"]);
  });
});

describe("maskAccount (security alerts)", () => {
  it("shows enough to recognise an account, not to read it", () => {
    expect(maskAccount("Omar.K@Gmail.com")).toBe("o***@gmail.com");
    expect(maskAccount("9647701234567")).toBe("+96477***67");
    expect(maskAccount("12")).toBe("***");
  });
});
