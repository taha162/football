/**
 * Talking to the site: a message that carries a code (or asks to stop
 * messages) goes to /api/whatsapp/webhook with the shared secret, and the
 * site answers with the reply to send. The bot also checks, now and then,
 * that SITE_URL leads to the site and that the site takes the secret, so the
 * site's admin page can say what is wrong before anyone's code goes unanswered.
 */

const WEBHOOK = "/api/whatsapp/webhook";

/**
 * What the site answered:
 *   reply   the text to send back (null: nothing to send);
 *   check   for a sender WhatsApp hides: the number the code was requested
 *           for, to compare with the sender before sending it again with it;
 *   reason  why there's nothing to check (e.g. "no_typed_number").
 * @typedef {{ ok: true, reply: string | null, check?: string, reason?: string }
 *   | { ok: false, problem: "refused_secret" | "refused" | "error" | "unreachable", status?: number }} ForwardResult
 */

/**
 * Hands a message to the site: `{from, text}` with the sender's number, or
 * `{hidden: true, text}` (from = null) when WhatsApp hides it.
 * @param {{
 *   siteUrl: string, secret: string, from: string | null, text: string,
 *   fetchImpl?: typeof fetch, timeoutMs?: number, tries?: number,
 *   sleep?: (ms: number) => Promise<void>, log?: (event: string, meta?: Record<string, unknown>) => void,
 * }} opts
 * @returns {Promise<ForwardResult>}
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
  /** @type {ForwardResult} */
  let last = { ok: false, problem: "unreachable" };
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchImpl(`${siteUrl}${WEBHOOK}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(from ? { from, text: text.slice(0, 500) } : { hidden: true, text: text.slice(0, 500) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        const check = typeof json?.check === "string" && /^[1-9]\d{7,14}$/.test(json.check) ? json.check : null;
        const reason = typeof json?.reason === "string" && /^[a-z_]{1,40}$/.test(json.reason) ? json.reason : null;
        return {
          ok: true,
          reply: typeof json?.reply === "string" && json.reply.trim() ? json.reply.slice(0, 2000) : null,
          ...(check ? { check } : {}),
          ...(reason ? { reason } : {}),
        };
      }
      if (res.status === 401) {
        log("site_refused_secret", { hint: "WHATSAPP_BOT_SECRET differs between the bot and the site" });
        return { ok: false, problem: "refused_secret", status: 401 };
      }
      // A request the site can't read won't improve by sending it again.
      if (res.status >= 400 && res.status < 500) {
        log("site_refused_message", { status: res.status });
        return { ok: false, problem: "refused", status: res.status };
      }
      log("site_error", { status: res.status, attempt });
      last = { ok: false, problem: "error", status: res.status };
    } catch (e) {
      log("site_unreachable", { attempt, message: String(/** @type {{ message?: string }} */ (e)?.message ?? e).slice(0, 120) });
      last = { ok: false, problem: "unreachable" };
    }
    if (attempt < tries) await sleep(attempt * 2000);
  }
  return last;
}

/**
 * @typedef {{
 *   state: "checking" | "ok" | "refused_secret" | "blocked" | "redirected" | "not_found" | "old_site" | "error" | "unreachable",
 *   status?: number, to?: string | null, at: string | null,
 * }} SiteCheck
 */

/**
 * Asks the site's webhook (GET, with the secret) whether it is there and
 * takes the secret. Nothing is read or written on the site.
 *   ok              the site answered and the secret is the same;
 *   refused_secret  the site answered, but with another secret;
 *   blocked         something in front of the site answered instead (Vercel's deployment protection, a firewall…);
 *   redirected      SITE_URL sends elsewhere (`to`): the secret wouldn't follow, so SITE_URL must be the final address;
 *   not_found       no such page: SITE_URL isn't this site;
 *   old_site        the site is older than this check: redeploy it;
 *   error           the site failed (5xx);
 *   unreachable     no answer at all.
 * @param {{ siteUrl: string, secret: string, fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number }} opts
 * @returns {Promise<SiteCheck>}
 */
export async function checkSite({ siteUrl, secret, fetchImpl = fetch, timeoutMs = 10_000, now = Date.now }) {
  const at = () => new Date(now()).toISOString();
  try {
    const res = await fetchImpl(`${siteUrl}${WEBHOOK}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
    if (res.status >= 300 && res.status < 400) {
      let to = null;
      try {
        const location = res.headers.get("location");
        to = location ? new URL(location, siteUrl).origin : null;
      } catch {
        /* no usable address */
      }
      return { state: "redirected", status: res.status, to, at: at() };
    }
    if (res.ok && json?.ok === true) return { state: "ok", at: at() };
    if (res.status === 401 && json?.error === "unauthorized") return { state: "refused_secret", status: 401, at: at() };
    if (res.status === 401 || res.status === 403) return { state: "blocked", status: res.status, at: at() };
    if (res.status === 405) return { state: "old_site", status: 405, at: at() };
    if (res.status >= 500) return { state: "error", status: res.status, at: at() };
    // 404, or a page that isn't the webhook's answer.
    return { state: "not_found", status: res.status, at: at() };
  } catch {
    return { state: "unreachable", at: at() };
  }
}
