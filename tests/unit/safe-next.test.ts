import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("where to go after signing in stays on the site", () => {
  it("keeps same-site paths, with their query and hash", () => {
    expect(safeNext("/ar/dashboard")).toBe("/ar/dashboard");
    expect(safeNext("/ar/venues/abc/book?date=2026-11-05&time=20:00#quote")).toBe("/ar/venues/abc/book?date=2026-11-05&time=20:00#quote");
    expect(safeNext("/ar/%D8%A7")).toBe("/ar/%D8%A7");
  });

  it("refuses anything a browser would read as another site", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/\u0000/evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "evil.com",
      "",
      " /ar",
    ]) {
      expect(safeNext(bad, "/x"), JSON.stringify(bad)).toBe("/x");
    }
    expect(safeNext(undefined)).toBe("/dashboard");
    expect(safeNext(42)).toBe("/dashboard");
    expect(safeNext(`/${"a".repeat(3000)}`, "/x")).toBe("/x");
  });

  it("an encoded slash stays a path on this site", () => {
    const kept = safeNext("/%2F/evil.com", "/x");
    expect(new URL(kept, "https://malab.example").origin).toBe("https://malab.example");
  });
});
