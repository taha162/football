import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

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
