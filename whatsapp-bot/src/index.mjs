import { join } from "node:path";
import { readConfig } from "./config.mjs";
import { createInboundHandler } from "./inbound.mjs";
import { OutboundQueue } from "./queue.mjs";
import { createApiServer } from "./server.mjs";
import { checkSite, forwardToSite } from "./site.mjs";
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

// Can the bot reach the site (SITE_URL) with the secret? Checked at start, every 15 minutes, and
// after a message couldn't be handed over; the site's admin page shows the answer.
/** @type {import("./site.mjs").SiteCheck} */
let site = { state: "checking", at: null };
/** @type {Promise<void> | null} */
let checking = null;
function refreshSite() {
  checking ??= checkSite({ siteUrl: config.siteUrl, secret: config.secret })
    .then((next) => {
      if (next.state !== site.state) log("site_check", { state: next.state, ...(next.status ? { status: next.status } : {}), ...(next.to ? { to: next.to } : {}) });
      site = next;
    })
    .finally(() => {
      checking = null;
    });
  return checking;
}

const inbound = createInboundHandler({
  texts: { help: config.helpText, noNumberCode: config.noNumberCodeText, noNumberStop: config.noNumberStopText, trouble: config.troubleText },
  inboundPerHour: config.inboundPerHour,
  pnForLid: (lid) => connection?.pnForLid(lid) ?? Promise.resolve(null),
  async forward(from, text) {
    const result = await forwardToSite({ siteUrl: config.siteUrl, secret: config.secret, from, text, log });
    if (!result.ok) void refreshSite();
    return result;
  },
  reply: (chat, text) => queue.reply(chat, text),
  dropFor: (phone) => queue.dropFor(phone),
  log,
});

connection = createConnection({ config, queue, log, onMessage: (msg, upsert) => inbound.handle(msg, upsert) });

const server = createApiServer({
  secret: config.secret,
  queue,
  connection: () => connection.state,
  site: () => ({ url: config.siteUrl, ...site }),
  inbound: () => inbound.recent(),
  log,
});
server.listen(config.port, () => log("listening", { port: config.port }));
void queue.start();
void refreshSite();
setInterval(() => void refreshSite(), 15 * 60_000).unref();
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
