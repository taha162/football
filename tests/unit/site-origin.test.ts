import { describe, expect, it } from "vitest";
import { siteOrigin } from "@/lib/env";

describe("siteOrigin", () => {
  it("keeps only the scheme and host", () => {
    expect(siteOrigin("https://al-malab.vercel.app")).toBe("https://al-malab.vercel.app");
    expect(siteOrigin("https://al-malab.vercel.app/")).toBe("https://al-malab.vercel.app");
    // Copied from the browser: the language path must not reach webhook or e-mail links.
    expect(siteOrigin("https://al-malab.vercel.app/ar")).toBe("https://al-malab.vercel.app");
    expect(siteOrigin(" https://al-malab.vercel.app/ar/matches?x=1#top \n")).toBe("https://al-malab.vercel.app");
    expect(siteOrigin("http://localhost:3000/en")).toBe("http://localhost:3000");
  });

  it("adds https when the scheme is missing", () => {
    expect(siteOrigin("al-malab.vercel.app/ar")).toBe("https://al-malab.vercel.app");
  });

  it("returns null for nothing usable", () => {
    expect(siteOrigin("")).toBeNull();
    expect(siteOrigin("   ")).toBeNull();
    expect(siteOrigin("https://")).toBeNull();
  });
});
