import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { logger } from "./log";
import { readBotSettings } from "./telegram-settings";

/**
 * The Telegram verification bot. Create it with @BotFather and set
 * TELEGRAM_BOT_TOKEN (secret, server only) and TELEGRAM_BOT_USERNAME
 * (public, without "@"). The webhook's secret token is derived from the bot
 * token, so there is nothing else to configure: an administrator registers
 * the webhook from Admin → Settings.
 */
export function telegramConfig() {
  const { token, username, problems } = readBotSettings(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_BOT_USERNAME);
  const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { enabled: problems.length === 0 && serviceRole, token, username, problems, serviceRole };
}

export function isTelegramEnabled(): boolean {
  return telegramConfig().enabled;
}

/**
 * The secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token with
 * every update (set when the webhook is registered). 64 hex characters.
 */
export function webhookSecret(token: string): string {
  return createHash("sha256").update(`al-malab-telegram-webhook:${token}`).digest("hex");
}

export function secretMatches(header: string | null, token: string): boolean {
  if (!header || !token) return false;
  const expected = Buffer.from(webhookSecret(token));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Opens the bot with the code as its start parameter. */
export function botLink(username: string, code: string): string {
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}

// ---- Bot API calls (used only from the admin settings page) ----------------

type ApiResult<T> = { ok: true; result: T } | { ok: false; error: string };

async function callBotApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (json?.ok) return { ok: true, result: json.result as T };
    return { ok: false, error: json?.description ?? `HTTP ${res.status}` };
  } catch (e) {
    logger.warn("telegram_api_unreachable", { method });
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

export interface WebhookState {
  /** The username the token belongs to. */
  botUsername: string | null;
  url: string;
  pendingUpdates: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

/** What Telegram reports about the bot and its webhook. */
export async function readWebhookState(token: string): Promise<ApiResult<WebhookState>> {
  const [me, info] = await Promise.all([
    callBotApi<{ username?: string }>(token, "getMe"),
    callBotApi<{ url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number }>(token, "getWebhookInfo"),
  ]);
  if (!me.ok) return me;
  if (!info.ok) return info;
  return {
    ok: true,
    result: {
      botUsername: me.result.username ?? null,
      url: info.result.url ?? "",
      pendingUpdates: info.result.pending_update_count ?? 0,
      lastError: info.result.last_error_message ?? null,
      lastErrorAt: info.result.last_error_date ? new Date(info.result.last_error_date * 1000).toISOString() : null,
    },
  };
}

/** Points the bot at this site's webhook, with the derived secret token. */
export async function registerWebhook(token: string, url: string): Promise<ApiResult<true>> {
  return callBotApi<true>(token, "setWebhook", {
    url,
    secret_token: webhookSecret(token),
    allowed_updates: ["message"],
    drop_pending_updates: true,
    max_connections: 20,
  });
}
