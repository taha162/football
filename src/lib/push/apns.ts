import "server-only";
import { connect, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { base64url, type PushMessage, type PushResult } from "@/lib/push/types";

/**
 * iPhone: Apple Push Notification service, straight (HTTP/2), with an APNs
 * key (.p8) from the Apple Developer account:
 * - APNS_KEY: the .p8 file's text (or in base64); APNS_KEY_ID, APNS_TEAM_ID.
 * - APNS_BUNDLE_ID: the app's id (com.almalab.app by default).
 * - APNS_ENV=sandbox for builds run from Xcode; the App Store's use production.
 */
interface ApnsConfig {
  key: KeyObject;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
}

export function apnsConfig(): ApnsConfig | null {
  const raw = process.env.APNS_KEY?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  if (!raw || !keyId || !teamId) return null;
  try {
    const pem = raw.includes("BEGIN PRIVATE KEY") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
    return {
      key: createPrivateKey(pem),
      keyId,
      teamId,
      bundleId: process.env.APNS_BUNDLE_ID?.trim() || "com.almalab.app",
      host: process.env.APNS_ENV === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com",
    };
  } catch {
    return null;
  }
}

let jwt: { value: string; until: number; keyId: string } | null = null;

/** Apple accepts a token for an hour and refuses new ones made too often: one every 50 minutes. */
function providerToken(c: ApnsConfig): string {
  if (jwt && jwt.keyId === c.keyId && jwt.until > Date.now()) return jwt.value;
  const unsigned = `${base64url(JSON.stringify({ alg: "ES256", kid: c.keyId }))}.${base64url(JSON.stringify({ iss: c.teamId, iat: Math.floor(Date.now() / 1000) }))}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: c.key, dsaEncoding: "ieee-p1363" });
  jwt = { value: `${unsigned}.${base64url(signature)}`, until: Date.now() + 50 * 60_000, keyId: c.keyId };
  return jwt.value;
}

/** One connection for a batch: open it, send through it, close it. */
export function apnsSession(c: ApnsConfig): ClientHttp2Session {
  return connect(c.host);
}

export function sendApns(c: ApnsConfig, session: ClientHttp2Session, token: string, message: PushMessage): Promise<PushResult> {
  return new Promise((resolve) => {
    if (!/^[0-9a-fA-F]{16,200}$/.test(token)) return resolve("gone");
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken(c)}`,
      "apns-topic": c.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      ...(message.tag ? { "apns-collapse-id": message.tag.slice(0, 64) } : {}),
    });
    let status = 0;
    let body = "";
    req.setTimeout(10_000, () => {
      req.close();
      resolve("failed");
    });
    req.on("response", (headers) => {
      status = Number(headers[":status"]);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      if (status === 200) return resolve("sent");
      if (status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(body)) return resolve("gone");
      if (status === 403 && /ExpiredProviderToken|InvalidProviderToken/.test(body)) jwt = null;
      resolve("failed");
    });
    req.on("error", () => resolve("failed"));
    req.end(
      JSON.stringify({
        aps: { alert: { title: message.title, body: message.body }, sound: "default", ...(message.tag ? { "thread-id": message.tag } : {}) },
        href: message.href,
      }),
    );
  });
}
