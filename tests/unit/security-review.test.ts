import { describe, expect, it } from "vitest";
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
