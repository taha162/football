import "server-only";
import { logger } from "@/lib/log";

/**
 * How two browsers find each other for a voice call (WebRTC ICE servers).
 *
 * - STUN (free, always on) lets most home and office networks connect
 *   directly.
 * - TURN relays the call when a direct path is impossible, which happens on
 *   some mobile networks. It is optional and configured in the environment:
 *     CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN (recommended: each
 *     call gets credentials that expire after a few hours), or
 *     TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL (any other TURN server).
 *   The secrets stay on the server; browsers only receive short-lived
 *   credentials for a call they are on.
 */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export const STUN_SERVERS: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

export type TurnSetup =
  | { kind: "cloudflare"; keyId: string; token: string }
  | { kind: "static"; urls: string[]; username: string; credential: string }
  | { kind: "none" };

export function turnSetup(): TurnSetup {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (keyId && token) return { kind: "cloudflare", keyId, token };
  const urls = (process.env.TURN_URLS ?? "").split(/[\s,]+/).filter((u) => /^turns?:/i.test(u));
  const username = process.env.TURN_USERNAME?.trim();
  const credential = process.env.TURN_CREDENTIAL?.trim();
  if (urls.length && username && credential) return { kind: "static", urls, username, credential };
  return { kind: "none" };
}

/** Browsers refuse port 53, so those addresses would only slow the connection down. */
const usable = (url: string) => /^(stun|turns?):/i.test(url) && !/:53(\?|$)/.test(url);

/** Accepts Cloudflare's answer as a list or a single entry; keeps only well-formed servers. */
export function readIceServers(raw: unknown): IceServer[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: IceServer[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = (Array.isArray(e.urls) ? e.urls : [e.urls]).filter((u): u is string => typeof u === "string").filter(usable);
    if (!urls.length) continue;
    out.push({
      urls,
      ...(typeof e.username === "string" ? { username: e.username } : {}),
      ...(typeof e.credential === "string" ? { credential: e.credential } : {}),
    });
  }
  return out;
}

/** Asks Cloudflare for credentials valid for a few hours. */
export async function cloudflareIceServers(keyId: string, token: string): Promise<{ ok: true; servers: IceServer[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 4 * 3600 }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: String(res.status) };
    const servers = readIceServers(((await res.json()) as { iceServers?: unknown })?.iceServers);
    return servers.length ? { ok: true, servers } : { ok: false, error: "empty" };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

/** The servers a call should use right now. Falls back to STUN alone, so a call still tries. */
export async function iceServersForCall(): Promise<IceServer[]> {
  const setup = turnSetup();
  if (setup.kind === "cloudflare") {
    const result = await cloudflareIceServers(setup.keyId, setup.token);
    if (result.ok) return result.servers;
    logger.error("turn_credentials_failed", { error: result.error });
    return STUN_SERVERS;
  }
  if (setup.kind === "static") return [...STUN_SERVERS, { urls: setup.urls, username: setup.username, credential: setup.credential }];
  return STUN_SERVERS;
}
