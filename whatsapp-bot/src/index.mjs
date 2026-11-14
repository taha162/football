import { join } from "node:path";
import { readConfig } from "./config.mjs";
import { classify, hourlyLimiter, senderPhone } from "./inbound.mjs";
import { OutboundQueue } from "./queue.mjs";
import { createApiServer } from "./server.mjs";
import { forwardToSite } from "./site.mjs";
import { jsonFile } from "./store.mjs";
import { createConnection } from "./whatsapp.mjs";

/**
 * «الملعب» WhatsApp bot. A long-running process (Railway, Render, a VPS),
 * linked to the platform's number, that:
 *   - forwards to the site the messages carrying a verification code or
 *     asking to stop messages, and sends back the site's reply;
 *   - answers any other text with one short help message;
 *   - sends the site's booking messages and promotions from one slow queue.
 * Logs are one JSON line each, without message text or full numbers.
 */

const log = (/** @type {string} */ event, /** @type {Record<string, unknown>} */ meta = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...meta }));

const { config, problems } = readConfig(process.env);
if (problems.length > 0) {
  for (const p of problems) log("config_problem", { problem: p });
  process.exit(1);
}

/** @type {ReturnType<typeof createConnection> | null} */
let connection = null;
const queue = new OutboundQueue({
  config,
  store: jsonFile(join(config.dataDir, "outbox.json")),
  log,
  transport: {
    isReady: () => connection?.transport.isReady() ?? false,
    lookup: (phone) => connection.transport.lookup(phone),
    typing: (jid, ms) => connection.transport.typing(jid, ms),
    send: (jid, text) => connection.transport.send(jid, text),
  },
});
await queue.restore();

// One chat may only make the bot work so much per hour, and gets the help text at most every 6 hours.
const perChat = hourlyLimiter(config.inboundPerHour);
/** @type {Map<string, number>} */
const helpedAt = new Map();
const HELP_EVERY_MS = 6 * 3_600_000;

connection = createConnection({
  config,
  queue,
  log,
  async onMessage(msg) {
    const what = classify(msg, { now: Date.now() });
    if (what.action === "ignore") return;
    if (!perChat.allow(what.chat)) {
      log("inbound_limited");
      return;
    }
    if (what.action === "help") {
      if (Date.now() - (helpedAt.get(what.chat) ?? 0) < HELP_EVERY_MS) return;
      helpedAt.set(what.chat, Date.now());
      queue.reply(what.chat, config.helpText);
      return;
    }
    // The verified number is the sender's own: never guessed when WhatsApp hides it behind a LID.
    const from = await senderPhone(msg.key, connection.pnForLid);
    if (!from) {
      log("sender_number_unknown", { kind: what.kind });
      return;
    }
    if (what.kind === "stop") {
      const dropped = queue.dropFor(from);
      log("stop_requested", { dropped: dropped.length });
    }
    const reply = await forwardToSite({ siteUrl: config.siteUrl, secret: config.secret, from, text: what.text, log });
    if (reply) queue.reply(what.chat, reply);
  },
});

const server = createApiServer({ secret: config.secret, queue, connection: () => connection.state, log });
server.listen(config.port, () => log("listening", { port: config.port }));
void queue.start();
await connection.start();

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    log("stopping", { signal });
    server.close();
    await queue.stop().catch(() => undefined);
    await connection.stop().catch(() => undefined);
    process.exit(0);
  });
}
