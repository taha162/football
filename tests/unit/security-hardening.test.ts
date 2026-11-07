import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "@/lib/client-ip";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";
import { sessionCookieOptions } from "@/lib/env";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

const headersOf = (entries: Record<string, string>) => new Headers(entries);

describe("clientIp (per-device limits)", () => {
  it("trusts the address the host set, not what the visitor put first in x-forwarded-for", () => {
    expect(clientIp(headersOf({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9, 198.51.100.7" }))).toBe("198.51.100.7");
  });
  it("falls back to the first forwarded hop, then to nothing", () => {
    expect(clientIp(headersOf({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(headersOf({}))).toBeNull();
  });
});

describe("sessionCookieOptions", () => {
  it("marks the session cookie Secure wherever the site is served over https", () => {
    expect(sessionCookieOptions("https://al-malab.example")).toEqual({ secure: true });
    expect(sessionCookieOptions("http://localhost:3000")).toEqual({ secure: false });
  });
});

describe("Content-Security-Policy", () => {
  const scriptSrc = (policy: string) => policy.split("; ").find((d) => d.startsWith("script-src "))!;

  it("pages: scripts need this response's nonce; inline script without it is refused", () => {
    const policy = contentSecurityPolicy("abc123==");
    expect(scriptSrc(policy)).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(scriptSrc(policy)).not.toContain("'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
  });

  it("other responses keep the nonce-less variant", () => {
    expect(scriptSrc(contentSecurityPolicy())).toBe("script-src 'self' 'unsafe-inline'");
  });

  it("nonces are fresh and carry 128 random bits", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(seen.size).toBe(200);
    for (const n of seen) expect(atob(n)).toHaveLength(16);
  });
});

describe("security events are logged", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a call to the scheduled-jobs endpoint without the secret is refused and logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    const { GET } = await import("@/app/api/cron/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("http://localhost/api/cron", { headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
    const lines = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines).toContainEqual(expect.objectContaining({ level: "warn", event: "cron_unauthorized", withHeader: true }));
    // The secret itself never reaches the log.
    expect(JSON.stringify(lines)).not.toContain("s".repeat(32));
    vi.unstubAllEnvs();
  });
});
