import "server-only";
import { createSign } from "node:crypto";
import { base64url, type PushMessage, type PushResult } from "@/lib/push/types";

/**
 * Android: Firebase Cloud Messaging (HTTP v1), with a Firebase service account
 * in FIREBASE_SERVICE_ACCOUNT (its JSON, or that JSON in base64). No library:
 * a signed token (RS256) buys an access token for an hour.
 */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function fcmConfig(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as Partial<ServiceAccount>;
    return json.project_id && json.client_email && json.private_key ? (json as ServiceAccount) : null;
  } catch {
    return null;
  }
}

let access: { token: string; until: number; account: string } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (access && access.account === sa.client_email && access.until > Date.now() + 60_000) return access.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`fcm_auth_${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  access = { token: json.access_token, until: Date.now() + json.expires_in * 1000, account: sa.client_email };
  return access.token;
}

export async function sendFcm(sa: ServiceAccount, token: string, message: PushMessage): Promise<PushResult> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: { href: message.href },
        android: { priority: "HIGH", notification: { sound: "default", ...(message.tag ? { tag: message.tag } : {}) } },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return "sent";
  const text = await res.text().catch(() => "");
  // The app was removed, or the token is no longer valid.
  if (res.status === 404 || /UNREGISTERED|registration token/i.test(text)) return "gone";
  if (res.status === 401) access = null;
  return "failed";
}
