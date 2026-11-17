import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { QueueFullError } from "./queue.mjs";

/**
 * The bot's small HTTP API, for the site only: every route but /healthz needs
 * `Authorization: Bearer WHATSAPP_BOT_SECRET`.
 *
 *   POST /send    {id?, to, text, kind?, image?, location?}
 *                                         queue a message (same id = same message); a picture
 *                                         ({url}: https) goes with the text, a place ({lat, lng,
 *                                         name?, address?}) follows it as a map pin
 *   POST /status  {ids}                   what became of messages
 *   POST /cancel  {ids, reason?}          drop messages that haven't gone out
 *   GET  /health                          connection, pause, queue, caps, can it reach the site, latest incoming messages
 *   GET  /link                            QR code or pairing code while unlinked
 *   POST /resume                          send again after a pause
 *   GET  /healthz                         "ok", for the host's health check
 *
 * `handle` is pure (given the queue and the connection state), so it is unit-tested.
 */

const MAX_BODY = 64 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A message's picture and place, checked: `{image?, location?}`, or an error
 * code. Nothing else from the request is kept.
 * @param {any} body
 * @returns {{ ok: true, media: { image?: { url: string }, location?: { lat: number, lng: number, name?: string, address?: string } } } | { ok: false, error: string }}
 */
export function readMedia(body) {
  /** @type {{ image?: { url: string }, location?: { lat: number, lng: number, name?: string, address?: string } }} */
  const media = {};
  if (body?.image != null) {
    const url = typeof body.image.url === "string" ? body.image.url.trim() : "";
    if (!/^https:\/\/\S+$/.test(url) || url.length > 1000) return { ok: false, error: "invalid_image" };
    media.image = { url };
  }
  if (body?.location != null) {
    const lat = Number(body.location.lat);
    const lng = Number(body.location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, error: "invalid_location" };
    const words = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    const name = words(body.location.name, 100);
    const address = words(body.location.address, 200);
    media.location = { lat, lng, ...(name ? { name } : {}), ...(address ? { address } : {}) };
  }
  return { ok: true, media };
}

/**
 * @param {string | undefined} header
 * @param {string} secret
 */
export function authorized(header, secret) {
  if (!header || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * @param {{ method: string, path: string, authorization?: string, body: any }} req
 * @param {{
 *   secret: string,
 *   queue: import("./queue.mjs").OutboundQueue,
 *   connection: () => { connection: string, linked: boolean, number: string | null, qrSvg: string | null, pairingCode: string | null, loggedOut: boolean },
 *   site?: () => { url: string } & import("./site.mjs").SiteCheck,
 *   inbound?: () => import("./inbound.mjs").InboundNote[],
 * }} deps
 * @returns {{ status: number, body: unknown }}
 */
export function handle({ method, path, authorization, body }, { secret, queue, connection, site, inbound }) {
  if (method === "GET" && path === "/healthz") return { status: 200, body: { ok: true } };
  if (!authorized(authorization, secret)) return { status: 401, body: { error: "unauthorized" } };
  const ids = (/** @type {unknown} */ list) =>
    Array.isArray(list) && list.length <= 500 && list.every((x) => typeof x === "string" && ID.test(x)) ? /** @type {string[]} */ (list) : null;

  if (method === "POST" && path === "/send") {
    const to = String(body?.to ?? "").replace(/^\+/, "");
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const kind = body?.kind === "promo" ? "promo" : "booking";
    if (!/^[1-9]\d{7,14}$/.test(to)) return { status: 400, body: { error: "invalid_number" } };
    if (!text || text.length > 2000) return { status: 400, body: { error: "invalid_text" } };
    if (body?.id !== undefined && !(typeof body.id === "string" && ID.test(body.id))) return { status: 400, body: { error: "invalid_id" } };
    const media = readMedia(body);
    if (!media.ok) return { status: 400, body: { error: media.error } };
    // While WhatsApp is restricting the number, or it is logged out, nothing new is taken.
    const paused = queue.paused;
    if (paused && paused.reason !== "consecutive_errors") return { status: 503, body: { error: "paused", reason: paused.reason } };
    try {
      return { status: 202, body: queue.enqueue({ id: body?.id, kind, to, text, ...media.media }) };
    } catch (e) {
      if (e instanceof QueueFullError) return { status: 503, body: { error: "queue_full" } };
      throw e;
    }
  }
  if (method === "POST" && path === "/status") {
    const list = ids(body?.ids);
    if (!list) return { status: 400, body: { error: "invalid_ids" } };
    return { status: 200, body: { results: queue.status(list) } };
  }
  if (method === "POST" && path === "/cancel") {
    const list = ids(body?.ids);
    if (!list) return { status: 400, body: { error: "invalid_ids" } };
    const reason = typeof body?.reason === "string" && /^[a-z_]{1,40}$/.test(body.reason) ? body.reason : "cancelled";
    return { status: 200, body: { cancelled: queue.cancel(list, reason) } };
  }
  if (method === "GET" && path === "/health") {
    const c = connection();
    return {
      status: 200,
      body: {
        connection: c.connection,
        linked: c.linked,
        number: c.number,
        ...queue.summary(),
        ...(site ? { site: site() } : {}),
        ...(inbound ? { inbound: inbound() } : {}),
      },
    };
  }
  if (method === "GET" && path === "/link") {
    const c = connection();
    const state = c.linked ? "linked" : c.pairingCode ? "pairing" : c.qrSvg ? "qr" : c.loggedOut ? "logged_out" : "connecting";
    return { status: 200, body: { state, ...(state === "qr" ? { qrSvg: c.qrSvg } : {}), ...(state === "pairing" ? { pairingCode: c.pairingCode } : {}) } };
  }
  if (method === "POST" && path === "/resume") {
    queue.resume();
    return { status: 200, body: { paused: null } };
  }
  return { status: 404, body: { error: "not_found" } };
}

/**
 * @param {Parameters<typeof handle>[1] & { log?: (event: string, meta?: Record<string, unknown>) => void }} deps
 */
export function createApiServer(deps) {
  return createServer((req, res) => {
    const send = (/** @type {number} */ status, /** @type {unknown} */ body) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        send(413, { error: "too_large" });
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let body = null;
      if (chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(400, { error: "invalid_json" });
        }
      }
      try {
        const path = new URL(req.url ?? "/", "http://bot").pathname;
        const out = handle({ method: req.method ?? "GET", path, authorization: req.headers.authorization, body }, deps);
        if (out.status === 401) deps.log?.("api_refused", { path });
        send(out.status, out.body);
      } catch (e) {
        deps.log?.("api_error", { message: String(/** @type {{ message?: string }} */ (e)?.message ?? e).slice(0, 160) });
        send(500, { error: "internal" });
      }
    });
  });
}
