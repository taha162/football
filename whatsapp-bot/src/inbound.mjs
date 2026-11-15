/**
 * Reading incoming WhatsApp messages: who sent them (their real number), and
 * what to do with them. Pure (no WhatsApp library), so it is unit-tested.
 */
import { findCode, isStopKeyword } from "./text.mjs";

const PN_JID = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/;
const LID_JID = /^\d+(?::\d+)?@lid$/;

/**
 * The number in a phone-number address ("9647701234567:3@s.whatsapp.net" → "9647701234567").
 * @param {unknown} jid
 * @returns {string | null}
 */
export function phoneOfJid(jid) {
  const m = PN_JID.exec(typeof jid === "string" ? jid : "");
  return m && /^[1-9]\d{7,14}$/.test(m[1]) ? m[1] : null;
}

/** @param {unknown} jid */
export const isLid = (jid) => typeof jid === "string" && LID_JID.test(jid);

/** A person's chat (by number or by LID), not a group, a broadcast, a channel, the status feed or a bot. @param {unknown} jid */
export const isPersonChat = (jid) => typeof jid === "string" && (PN_JID.test(jid) || LID_JID.test(jid));

/**
 * The text of a message, looking inside disappearing-message and view-once
 * envelopes. Null for anything else: pictures, voice notes, stickers,
 * reactions, edits, deletions, polls, calls…
 * @param {any} message
 * @returns {string | null}
 */
export function textOf(message) {
  let m = message;
  for (let i = 0; i < 3 && m; i++) {
    const inner = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message;
    if (!inner) break;
    m = inner;
  }
  const text = m?.conversation ?? m?.extendedTextMessage?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/**
 * What to do with a message:
 *   ignore  — groups, our own messages, anything but text, very old messages;
 *   forward — a code (verification) or a request to stop messages, to the site;
 *   help    — any other text: answered here with one short help message.
 * @param {any} msg a Baileys WAMessage
 * @param {{ now: number, maxAgeMs?: number }} opts
 * @returns {{ action: "ignore", reason: string } | { action: "forward", kind: "code" | "stop", chat: string, text: string } | { action: "help", chat: string }}
 */
export function classify(msg, { now, maxAgeMs = 2 * 3_600_000 }) {
  const key = msg?.key;
  const chat = key?.remoteJid;
  if (!key || typeof chat !== "string") return { action: "ignore", reason: "no_key" };
  if (key.fromMe) return { action: "ignore", reason: "outgoing" };
  if (!isPersonChat(chat)) return { action: "ignore", reason: "not_a_person" };
  // A message that couldn't be decrypted arrives as a stub (CIPHERTEXT, 2); WhatsApp is asked to send it again.
  if (!msg.message) return { action: "ignore", reason: msg.messageStubType === 2 ? "unreadable" : "empty" };
  // Seconds; Baileys gives a number or a protobuf Long.
  const ts = msg.messageTimestamp;
  const sentAt = (typeof ts?.toNumber === "function" ? ts.toNumber() : Number(ts ?? 0)) * 1000;
  // Messages that waited while the bot was down for long: answering them now would only confuse.
  if (sentAt > 0 && now - sentAt > maxAgeMs) return { action: "ignore", reason: "old" };
  const text = textOf(msg.message);
  if (text === null) return { action: "ignore", reason: "not_text" };
  if (isStopKeyword(text)) return { action: "forward", kind: "stop", chat, text: text.slice(0, 500) };
  if (findCode(text)) return { action: "forward", kind: "code", chat, text: text.slice(0, 500) };
  return { action: "help", chat };
}

const wait = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The sender's real number, and where it came from. WhatsApp more and more
 * addresses people by a LID (an anonymous id) instead of their number; the
 * number then comes from the message's alternative address (remoteJidAlt in
 * Baileys 7, senderPn in 6.x) or from the LID-to-number mapping the session
 * has learnt. The mapping can arrive a moment after the message, so it is
 * asked again after each of `waits` (milliseconds). Null when the number
 * can't be known: it is never guessed.
 * @param {any} key the message key
 * @param {((lid: string) => Promise<string | null | undefined>) | null} [pnForLid]
 * @param {{ waits?: number[], sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {Promise<{ phone: string, via: "chat" | "alt" | "mapping" } | null>}
 */
export async function senderPhone(key, pnForLid = null, { waits = [], sleep = wait } = {}) {
  const own = phoneOfJid(key?.remoteJid);
  if (own) return { phone: own, via: "chat" };
  for (const jid of [key?.remoteJidAlt, key?.senderPn]) {
    const phone = phoneOfJid(jid);
    if (phone) return { phone, via: "alt" };
  }
  if (!isLid(key?.remoteJid) || !pnForLid) return null;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) await sleep(waits[attempt - 1]);
    try {
      const phone = phoneOfJid(await pnForLid(key.remoteJid));
      if (phone) return { phone, via: "mapping" };
    } catch {
      /* not known (yet) */
    }
  }
  return null;
}

/**
 * At most `limit` events per key in a sliding hour: messages from one chat,
 * so nobody can make the bot talk endlessly (or loop with another bot).
 * @param {number} limit
 * @param {() => number} [now]
 */
export function hourlyLimiter(limit, now = Date.now) {
  /** @type {Map<string, number[]>} */
  const seen = new Map();
  return {
    /** @param {string} key */
    allow(key) {
      const t = now();
      const recent = (seen.get(key) ?? []).filter((x) => t - x < 3_600_000);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return false;
      }
      recent.push(t);
      seen.set(key, recent);
      if (seen.size > 10_000) for (const [k, v] of seen) if (v.every((x) => t - x >= 3_600_000)) seen.delete(k);
      return true;
    },
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Ignored without a note: our own messages, groups and the like are not someone writing to the bot. */
const QUIET = new Set(["no_key", "outgoing", "not_a_person"]);
const RECENT = 8;

/**
 * @typedef {{ at: string, kind: "code" | "stop" | "help" | "other", outcome: string }} InboundNote
 */

/**
 * What the bot does with each incoming message:
 *   - a code or a stop word goes to the site with the sender's real number,
 *     and the site's reply goes back to the chat;
 *   - when the number can't be known, or the site can't be reached, the
 *     sender is told so (at most every 15 minutes) instead of hearing nothing;
 *   - any other text gets the help message, at most every 6 hours per chat.
 * The same message delivered twice (for example once while the bot was
 * reconnecting) is handled once. The latest outcomes are kept, with the time
 * and the kind of message only (never the number or the text), for the
 * site's admin page.
 *
 * @param {{
 *   texts: { help: string, noNumberCode: string, noNumberStop: string, trouble: string },
 *   inboundPerHour: number,
 *   pnForLid?: ((lid: string) => Promise<string | null | undefined>) | null,
 *   forward: (from: string, text: string) => Promise<import("./site.mjs").ForwardResult>,
 *   reply: (chat: string, text: string) => unknown,
 *   dropFor: (phone: string) => unknown[],
 *   log?: (event: string, meta?: Record<string, unknown>) => void,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   lidWaits?: number[],
 * }} deps
 */
export function createInboundHandler(deps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const perChat = hourlyLimiter(deps.inboundPerHour, now);
  /** When each kind of answer last went to each chat. @type {Map<string, number>} */
  const said = new Map();
  /** Messages already handled. @type {Set<string>} */
  const seen = new Set();
  /** Newest first. @type {InboundNote[]} */
  const recent = [];

  /** True (and remembered) when `what` wasn't said to `chat` in the last `everyMs`. */
  const sayOnce = (/** @type {string} */ chat, /** @type {string} */ what, /** @type {number} */ everyMs) => {
    const key = `${what}|${chat}`;
    const t = now();
    const last = said.get(key);
    if (last !== undefined && t - last < everyMs) return false;
    said.set(key, t);
    if (said.size > 5000) for (const [k, v] of said) if (t - v > 6 * HOUR) said.delete(k);
    return true;
  };

  const note = (/** @type {InboundNote["kind"]} */ kind, /** @type {string} */ outcome, /** @type {Record<string, unknown>} */ meta) => {
    recent.unshift({ at: new Date(now()).toISOString(), kind, outcome });
    if (recent.length > RECENT) recent.length = RECENT;
    log("inbound", { kind, outcome, ...meta });
    return outcome;
  };

  /**
   * @param {any} msg a Baileys WAMessage
   * @param {string} [upsert] "notify" (live) or "append" (delivered on reconnecting)
   * @returns {Promise<string>} the outcome
   */
  async function handle(msg, upsert = "notify") {
    const what = classify(msg, { now: now() });
    /** @type {Record<string, unknown>} */
    const meta = { upsert, chat: isLid(msg?.key?.remoteJid) ? "lid" : "pn" };
    if (what.action === "ignore") return QUIET.has(what.reason) ? what.reason : note("other", what.reason, meta);
    if (typeof msg.key.id === "string" && msg.key.id) {
      const id = `${what.chat}|${msg.key.id}`;
      if (seen.has(id)) return "duplicate";
      seen.add(id);
      if (seen.size > 2000) seen.delete(/** @type {string} */ (seen.values().next().value));
    }
    const kind = what.action === "help" ? "help" : what.kind;
    if (!perChat.allow(what.chat)) return note(kind, "limited", meta);
    if (what.action === "help") {
      if (!sayOnce(what.chat, "help", 6 * HOUR)) return note(kind, "help_recent", meta);
      deps.reply(what.chat, deps.texts.help);
      return note(kind, "help_sent", meta);
    }
    // The verified number is the sender's own: never guessed when WhatsApp hides it behind a LID.
    const sender = await senderPhone(msg.key, deps.pnForLid ?? null, { waits: deps.lidWaits ?? [2000, 4000], ...(deps.sleep ? { sleep: deps.sleep } : {}) });
    if (!sender) {
      if (sayOnce(what.chat, "no_number", 15 * MIN)) deps.reply(what.chat, what.kind === "stop" ? deps.texts.noNumberStop : deps.texts.noNumberCode);
      return note(kind, "no_number", meta);
    }
    meta.via = sender.via;
    if (what.kind === "stop") meta.dropped = deps.dropFor(sender.phone).length;
    const result = await deps.forward(sender.phone, what.text);
    if (result.ok) {
      if (!result.reply) return note(kind, "no_reply", meta);
      deps.reply(what.chat, result.reply);
      return note(kind, "replied", meta);
    }
    if (sayOnce(what.chat, "trouble", 15 * MIN)) deps.reply(what.chat, deps.texts.trouble);
    return note(kind, `site_${result.problem}`, { ...meta, ...(result.status ? { status: result.status } : {}) });
  }

  return { handle, recent: () => recent.map((r) => ({ ...r })) };
}
