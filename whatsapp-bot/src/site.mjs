/**
 * Talking to the site: a message that carries a code (or asks to stop
 * messages) goes to /api/whatsapp/webhook with the shared secret, and the
 * site answers with the reply to send.
 */

/**
 * @param {{
 *   siteUrl: string, secret: string, from: string, text: string,
 *   fetchImpl?: typeof fetch, timeoutMs?: number, tries?: number,
 *   sleep?: (ms: number) => Promise<void>, log?: (event: string, meta?: Record<string, unknown>) => void,
 * }} opts
 * @returns {Promise<string | null>} the reply, or null when there is none to send
 */
export async function forwardToSite({
  siteUrl,
  secret,
  from,
  text,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  tries = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchImpl(`${siteUrl}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, text: text.slice(0, 500) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        return typeof json?.reply === "string" && json.reply.trim() ? json.reply.slice(0, 2000) : null;
      }
      if (res.status === 401) {
        log("site_refused_secret", { hint: "WHATSAPP_BOT_SECRET differs between the bot and the site" });
        return null;
      }
      // A request the site can't read won't improve by sending it again.
      if (res.status >= 400 && res.status < 500) {
        log("site_refused_message", { status: res.status });
        return null;
      }
      log("site_error", { status: res.status, attempt });
    } catch (e) {
      log("site_unreachable", { attempt, message: String(/** @type {{ message?: string }} */ (e)?.message ?? e).slice(0, 120) });
    }
    if (attempt < tries) await sleep(attempt * 2000);
  }
  return null;
}
