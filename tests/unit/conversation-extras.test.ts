import { describe, expect, it, vi } from "vitest";
import { formatDistance, formatDuration } from "@/lib/duration";
import { mapsUrl, metresPerPixel, readPoint, tilePosition, tilesAround } from "@/lib/geo";

vi.mock("server-only", () => ({}));
const { readIceServers, turnSetup } = await import("@/lib/turn");

describe("a shared location", () => {
  it("reads a point from form values, or says there is none, or that it is malformed", () => {
    expect(readPoint("36.3456", "43.1234", "12")).toEqual({ lat: 36.3456, lng: 43.1234, accuracy: 12 });
    expect(readPoint("36.3456", "43.1234", "")).toEqual({ lat: 36.3456, lng: 43.1234, accuracy: null });
    expect(readPoint(null, null, null)).toBeNull();
    expect(readPoint("", " ", "12")).toBeNull();
    expect(readPoint("36", null, null)).toBe("invalid");
    expect(readPoint("91", "43", null)).toBe("invalid");
    expect(readPoint("36", "181", null)).toBe("invalid");
    expect(readPoint("NaN", "43", null)).toBe("invalid");
    expect(readPoint("36", "Infinity", null)).toBe("invalid");
    expect(readPoint("36", "43", "-3")).toBe("invalid");
  });

  it("opens in the phone's maps app at the point", () => {
    expect(mapsUrl(36.3456, 43.1234)).toBe("https://www.google.com/maps/search/?api=1&query=36.345600,43.123400");
  });

  it("finds the map tiles around the point, with the point in the middle", () => {
    // Mosul's centre at street level, checked against the standard slippy-map formula.
    const { x, y } = tilePosition(36.34, 43.13, 16);
    expect(Math.floor(x)).toBe(Math.floor(((43.13 + 180) / 360) * 2 ** 16));
    expect(Math.floor(y)).toBe(Math.floor(((1 - Math.asinh(Math.tan((36.34 * Math.PI) / 180)) / Math.PI) / 2) * 2 ** 16));
    expect(Math.floor(x)).toBe(40619);
    const tiles = tilesAround(36.34, 43.13, 16, 256, 144);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
    // The view's centre falls inside one of the tiles.
    expect(tiles.some((t) => t.left <= 128 && t.left + 256 > 128 && t.top <= 72 && t.top + 256 > 72)).toBe(true);
    // About 1.9 m per pixel there, so 12 m of accuracy is a ring of ~6 px.
    expect(metresPerPixel(36.34, 16)).toBeCloseTo(1.94, 1);
  });
});

describe("lengths and distances", () => {
  it("shows a length as m:ss in Arabic digits", () => {
    expect(formatDuration(7, "ar")).toBe("٠:٠٧");
    expect(formatDuration(192, "ar")).toBe("٣:١٢");
    expect(formatDuration(3725, "ar")).toBe("١:٠٢:٠٥");
    expect(formatDuration(65, "en")).toBe("1:05");
    expect(formatDuration(Number.NaN, "ar")).toBe("٠:٠٠");
  });

  it("rounds a distance for people", () => {
    const units = { m: (n: string) => `${n} م`, km: (n: string) => `${n} كم` };
    expect(formatDistance(12.4, "ar", units)).toBe("١٢ م");
    expect(formatDistance(0.2, "ar", units)).toBe("١ م");
    expect(formatDistance(1250, "ar", units)).toBe("١٫٣ كم");
  });
});

describe("call connection servers", () => {
  it("keeps well-formed servers and drops the port-53 addresses browsers refuse", () => {
    const servers = readIceServers([
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: "u",
        credential: "c",
      },
      { urls: ["https://not-a-turn-server"] },
      "junk",
    ]);
    expect(servers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" },
    ]);
    // The older answer shape: a single entry.
    expect(readIceServers({ urls: "turn:t.example:3478", username: "u", credential: "c" })).toEqual([{ urls: ["turn:t.example:3478"], username: "u", credential: "c" }]);
  });

  it("reads the relay settings from the environment", () => {
    vi.stubEnv("CLOUDFLARE_TURN_KEY_ID", "");
    vi.stubEnv("CLOUDFLARE_TURN_API_TOKEN", "");
    vi.stubEnv("TURN_URLS", "");
    expect(turnSetup()).toEqual({ kind: "none" });
    vi.stubEnv("TURN_URLS", "turn:relay.example:3478, turns:relay.example:5349 https://ignored");
    vi.stubEnv("TURN_USERNAME", "user");
    vi.stubEnv("TURN_CREDENTIAL", "secret");
    expect(turnSetup()).toEqual({ kind: "static", urls: ["turn:relay.example:3478", "turns:relay.example:5349"], username: "user", credential: "secret" });
    vi.stubEnv("CLOUDFLARE_TURN_KEY_ID", " key ");
    vi.stubEnv("CLOUDFLARE_TURN_API_TOKEN", "token");
    expect(turnSetup()).toEqual({ kind: "cloudflare", keyId: "key", token: "token" });
    vi.unstubAllEnvs();
  });
});
