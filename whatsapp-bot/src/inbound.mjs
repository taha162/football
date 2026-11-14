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
  if (!msg.message) return { action: "ignore", reason: "empty" };
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

/**
 * The sender's real number. WhatsApp more and more addresses people by a LID
 * (an anonymous id) instead of their number; the number then comes from the
 * message's alternative address (remoteJidAlt in Baileys 7, senderPn in 6.x)
 * or from the LID-to-number mapping the session has learnt. Null when it
 * can't be known: the message is then ignored, never guessed.
 * @param {any} key the message key
 * @param {((lid: string) => Promise<string | null | undefined>) | null} [pnForLid]
 * @returns {Promise<string | null>}
 */
export async function senderPhone(key, pnForLid = null) {
  for (const jid of [key?.remoteJid, key?.remoteJidAlt, key?.senderPn]) {
    const phone = phoneOfJid(jid);
    if (phone) return phone;
  }
  if (isLid(key?.remoteJid) && pnForLid) {
    try {
      return phoneOfJid(await pnForLid(key.remoteJid));
    } catch {
      return null;
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
