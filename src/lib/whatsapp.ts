import "server-only";
import { timingSafeEqual } from "node:crypto";
import { logger } from "./log";
import { isVerifyProblem, readWhatsappSettings } from "./whatsapp-settings";

/**
 * The WhatsApp bot: a separate service (whatsapp-bot/) linked to the
 * platform's own WhatsApp number, without Meta's Cloud API. Three settings:
 *   WHATSAPP_BOT_SECRET  shared with the bot (32+ characters, server only);
 *   WHATSAPP_BOT_NUMBER  the platform's number, for wa.me links;
 *   WHATSAPP_BOT_URL     where the bot listens (needed for outgoing messages).
 */
export function whatsappConfig() {
  const settings = readWhatsappSettings(process.env.WHATSAPP_BOT_SECRET, process.env.WHATSAPP_BOT_NUMBER, process.env.WHATSAPP_BOT_URL);
  const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  // Sign-up and password reset by WhatsApp: the bot posts codes to the webhook.
  const enabled = serviceRole && !settings.problems.some(isVerifyProblem);
  // Booking messages and promotions: the site also calls the bot.
  const canSend = enabled && !settings.problems.some((p) => p.startsWith("url"));
  return { ...settings, serviceRole, enabled, canSend };
}

export function isWhatsappEnabled(): boolean {
  return whatsappConfig().enabled;
}

/** `Authorization: Bearer <secret>`, compared in constant time. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Opens WhatsApp on the platform's number with the code already typed. */
export function chatLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

// ---- Calls to the bot ------------------------------------------------------

export type BotResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

async function callBot<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 8000): Promise<BotResult<T>> {
  const cfg = whatsappConfig();
  if (!cfg.canSend) return { ok: false, status: 0, error: "not_configured" };
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.secret}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (res.ok && json) return { ok: true, status: res.status, data: json };
    if (res.status === 401) logger.error("whatsapp_bot_refused_secret", { path });
    return { ok: false, status: res.status, error: typeof json?.error === "string" ? json.error.slice(0, 60) : `http_${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

export type BotState = "queued" | "sent" | "failed" | "cancelled" | "opted_out" | "unknown";

export interface BotHealth {
  connection: "open" | "connecting" | "close";
  linked: boolean;
  number: string | null;
  paused: { reason: string; until: string | null } | null;
  queue: { total: number; replies: number; booking: number; promo: number };
  sent: { lastHour: number; today: number };
  caps: { perHour: number; perDay: number };
}

export const bot = {
  send: (msg: { id: string; to: string; text: string; kind: "booking" | "promo" }) =>
    callBot<{ id: string; state: BotState; position?: number }>("POST", "/send", msg),
  status: (ids: string[]) => callBot<{ results: Record<string, { state: BotState; error?: string; at?: string }> }>("POST", "/status", { ids }),
  cancel: (ids: string[], reason: string) => callBot<{ cancelled: string[] }>("POST", "/cancel", { ids, reason }),
  health: () => callBot<BotHealth>("GET", "/health", undefined, 5000),
  link: () => callBot<{ state: "linked" | "qr" | "pairing" | "connecting" | "logged_out"; qrSvg?: string; pairingCode?: string }>("GET", "/link", undefined, 5000),
  resume: () => callBot<{ paused: null }>("POST", "/resume", {}),
};
