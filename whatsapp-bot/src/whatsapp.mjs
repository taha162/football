import { rm } from "node:fs/promises";
import { join } from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  // Not a React hook, whatever its name says (the site's lint rules would think so).
  useMultiFileAuthState as multiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { isPersonChat, phoneOfJid } from "./inbound.mjs";

/**
 * The link to WhatsApp: the platform's number, linked like WhatsApp Web (a
 * QR code, or a pairing code with WA_PAIRING_NUMBER), with the session kept
 * in DATA_DIR/auth on the volume. It reconnects by itself; when WhatsApp logs
 * the number out it starts a fresh link (a new QR code) and the queue waits.
 *
 * @param {{
 *   config: { dataDir: string, logLevel: string, pairingNumber: string | null },
 *   queue: import("./queue.mjs").OutboundQueue,
 *   onMessage: (msg: any) => Promise<void>,
 *   log: (event: string, meta?: Record<string, unknown>) => void,
 * }} deps
 */
export function createConnection({ config, queue, onMessage, log }) {
  const state = {
    connection: "close",
    linked: false,
    /** @type {string | null} */
    number: null,
    /** @type {string | null} */
    qrSvg: null,
    /** @type {string | null} */
    pairingCode: null,
    loggedOut: false,
  };
  /** @type {any} */
  let sock = null;
  let retries = 0;
  let stopped = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  // Recently sent messages, so WhatsApp's re-delivery requests can be answered.
  /** @type {Map<string, any>} */
  const sent = new Map();
  const baileysLog = pino({ level: config.logLevel === "debug" ? "info" : "warn" });
  const authDir = join(config.dataDir, "auth");

  const later = (/** @type {number} */ ms) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void connect().catch((e) => log("connect_failed", { message: String(e?.message ?? e) })), ms);
  };

  async function connect() {
    if (stopped) return;
    const { state: auth, saveCreds } = await multiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    state.connection = "connecting";
    let askedPairing = false;
    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, baileysLog) },
      logger: baileysLog,
      browser: Browsers.ubuntu("Chrome"),
      // The phone keeps getting its notifications; the bot reads no history.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Groups, broadcasts, channels and the status feed are never even read.
      shouldIgnoreJid: (/** @type {string} */ jid) => !isPersonChat(jid),
      getMessage: async (/** @type {{ id?: string }} */ key) => (key?.id ? sent.get(key.id) : undefined),
    });
    const current = sock;

    current.ev.on("creds.update", saveCreds);

    current.ev.on("connection.update", async (/** @type {any} */ u) => {
      if (current !== sock) return;
      if (u.qr) {
        state.qrSvg = await QRCode.toString(u.qr, { type: "svg", margin: 1 }).catch(() => null);
        if (config.pairingNumber && !auth.creds.registered && !askedPairing) {
          askedPairing = true;
          try {
            state.pairingCode = await current.requestPairingCode(config.pairingNumber);
            log("pairing_code", { code: state.pairingCode, hint: "WhatsApp → Linked devices → Link with phone number instead" });
          } catch (e) {
            log("pairing_code_failed", { message: String(/** @type {any} */ (e)?.message ?? e).slice(0, 120) });
          }
        } else if (!config.pairingNumber) {
          const art = await QRCode.toString(u.qr, { type: "terminal", small: true }).catch(() => "");
          log("qr_code", { hint: "Scan from WhatsApp → Linked devices → Link a device (also shown in the site's Admin → Settings)" });
          if (art) console.log(art);
        }
      }
      if (u.reachoutTimeLock?.isActive) {
        // "WhatsApp prevents outgoing messages": wait until it says the lock ends.
        const ends = u.reachoutTimeLock.timeEnforcementEnds ? new Date(u.reachoutTimeLock.timeEnforcementEnds).getTime() : null;
        queue.pause("ban_signal", ends && ends > Date.now() ? ends : null);
        log("whatsapp_restricted_number", { until: ends ? new Date(ends).toISOString() : null, type: u.reachoutTimeLock.enforcementType ?? null });
      }
      if (u.connection === "open") {
        state.connection = "open";
        state.linked = true;
        state.loggedOut = false;
        state.number = phoneOfJid(current.user?.id);
        state.qrSvg = null;
        state.pairingCode = null;
        retries = 0;
        queue.resumeIf("logged_out");
        log("connected", { number: state.number ? `${state.number.slice(0, 6)}…` : null });
      } else if (u.connection === "connecting") {
        state.connection = "connecting";
      } else if (u.connection === "close") {
        state.connection = "close";
        const code = Number(u.lastDisconnect?.error?.output?.statusCode ?? 0);
        if (code === DisconnectReason.loggedOut) {
          // The link is gone (removed from the phone, or by WhatsApp): start a fresh one.
          state.linked = false;
          state.loggedOut = true;
          queue.pause("logged_out");
          log("logged_out", { hint: "link the number again: Admin → Settings shows the new QR code" });
          await rm(authDir, { recursive: true, force: true }).catch(() => undefined);
          later(5_000);
        } else if (code === DisconnectReason.forbidden) {
          queue.pause("ban_signal");
          log("whatsapp_refused_connection", { code });
          later(10 * 60_000);
        } else if (code === DisconnectReason.connectionReplaced) {
          // Another copy of the bot uses the same session: two would keep kicking each other off.
          log("connection_replaced", { hint: "only one copy of the bot may run with this session" });
          later(5 * 60_000);
        } else if (code === DisconnectReason.restartRequired) {
          later(500);
        } else {
          retries += 1;
          const wait = Math.min(60_000, 1000 * 2 ** Math.min(retries, 6));
          log("disconnected", { code, retryInMs: wait });
          later(wait);
        }
      }
    });

    current.ev.on("message-capping.update", (/** @type {any} */ cap) => {
      if (["FIRST_WARNING", "SECOND_WARNING", "CAPPED"].includes(cap?.capping_status)) {
        const ends = cap.cycle_end_timestamp ? Number(cap.cycle_end_timestamp) * 1000 : null;
        queue.pause("ban_signal", cap.capping_status === "CAPPED" && ends && ends > Date.now() ? ends : null);
        log("whatsapp_new_chat_cap", { status: cap.capping_status });
      }
    });

    current.ev.on("messages.upsert", async (/** @type {{ messages: any[], type: string }} */ { messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        await onMessage(msg).catch((e) => log("message_failed", { message: String(e?.message ?? e).slice(0, 120) }));
      }
    });
  }

  return {
    state,
    start: () => connect(),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      sock?.end?.(undefined);
    },
    /** The number behind a LID, as far as the session knows it. @param {string} lid */
    pnForLid: async (lid) => sock?.signalRepository?.lidMapping?.getPNForLID?.(lid) ?? null,
    /** @type {import("./queue.mjs").Transport} */
    transport: {
      isReady: () => state.connection === "open",
      async lookup(phone) {
        const found = await sock.onWhatsApp(phone);
        const hit = Array.isArray(found) ? found.find((r) => r?.exists) : null;
        return hit?.jid ?? null;
      },
      async typing(jid, ms) {
        // "typing…" is a courtesy: if it fails, the message still goes.
        try {
          await sock.presenceSubscribe(jid);
          await sock.sendPresenceUpdate("composing", jid);
          await new Promise((resolve) => setTimeout(resolve, ms));
          await sock.sendPresenceUpdate("paused", jid);
        } catch {
          /* ignored */
        }
      },
      async send(jid, text) {
        const msg = await sock.sendMessage(jid, { text });
        if (msg?.key?.id) {
          sent.set(msg.key.id, msg.message);
          if (sent.size > 500) sent.delete(sent.keys().next().value);
        }
      },
    },
  };
}
