import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { logger } from "./log";

/**
 * WhatsApp Cloud API (Meta) configuration. Verification only *receives*
 * messages, so only the webhook settings are required; the access token is
 * optional and used solely to send a short "verified" reply inside the free
 * customer-service window.
 */
export function whatsappConfig() {
  const number = (process.env.WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const enabled = Boolean(number && verifyToken && appSecret && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { enabled, number, verifyToken, appSecret, accessToken, phoneNumberId, canReply: Boolean(accessToken && phoneNumberId) };
}

export function isWhatsappEnabled(): boolean {
  return whatsappConfig().enabled;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** Eight characters from a 31-symbol alphabet (~40 bits), shown as XXXX-XXXX. */
export function newVerificationCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function newTicket(): { ticket: string; hash: string } {
  const ticket = randomBytes(32).toString("base64url");
  return { ticket, hash: hashTicket(ticket) };
}

export function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

/** wa.me link that opens a chat with the platform number and the code pre-filled. */
export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** Validates Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface InboundText {
  id: string;
  from: string;
  body: string;
}

/** Extracts inbound text messages from a Cloud API webhook payload. */
export function inboundTexts(payload: unknown): InboundText[] {
  const out: InboundText[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown[] } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = m as { id?: unknown; from?: unknown; type?: unknown; text?: { body?: unknown } };
        if (msg.type === "text" && typeof msg.id === "string" && typeof msg.from === "string" && typeof msg.text?.body === "string") {
          out.push({ id: msg.id, from: msg.from, body: msg.text.body.slice(0, 1000) });
        }
      }
    }
  }
  return out;
}

/** Optional reply within the 24-hour service window. Failures are logged, never thrown. */
export async function sendWhatsappText(to: string, body: string): Promise<void> {
  const cfg = whatsappConfig();
  if (!cfg.canReply) return;
  try {
    const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
    const res = await fetch(`https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) logger.warn("whatsapp_reply_failed", { status: res.status });
  } catch {
    logger.warn("whatsapp_reply_failed", { status: 0 });
  }
}
