import { describe, expect, it, vi } from "vitest";
import { readConfig, siteOrigin } from "../../whatsapp-bot/src/config.mjs";
import { classify, hourlyLimiter, phoneOfJid, senderPhone, textOf } from "../../whatsapp-bot/src/inbound.mjs";
import { isBanSignal, OutboundQueue, QueueFullError, startOfDay } from "../../whatsapp-bot/src/queue.mjs";
import { handle } from "../../whatsapp-bot/src/server.mjs";
import { forwardToSite } from "../../whatsapp-bot/src/site.mjs";
import { memoryStore } from "../../whatsapp-bot/src/store.mjs";
import { findCode, isStopKeyword } from "../../whatsapp-bot/src/text.mjs";

/**
 * The WhatsApp bot's own logic, without WhatsApp: the outbound queue with a
 * fake clock, reading incoming messages (LID addressing included), the HTTP
 * API the site calls, and the settings.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const CONFIG = {
  minDelayMs: 8000,
  maxDelayMs: 25_000,
  maxPerHour: 3,
  maxPerDay: 5,
  maxConsecutiveErrors: 3,
  pauseMinutes: 30,
  maxQueue: 20,
  timeZone: "Asia/Baghdad",
};
const SECRET = "s".repeat(40);

function setup(opts: { config?: Partial<typeof CONFIG>; random?: () => number; store?: ReturnType<typeof memoryStore> } = {}) {
  // Saturday 14 November 2026, 12:00 in Baghdad (09:00 UTC).
  let t = Date.UTC(2026, 10, 14, 9, 0, 0);
  const events: string[] = [];
  const transport = {
    ready: true,
    isReady() {
      return this.ready;
    },
    lookup: vi.fn(async (phone: string) => (phone.startsWith("964") ? `${phone}@s.whatsapp.net` : null)),
    typing: vi.fn(async (jid: string) => {
      events.push(`typing ${jid}`);
    }),
    send: vi.fn(async (jid: string, text: string) => {
      events.push(`send ${jid} ${text}`);
    }),
  };
  const queue = new OutboundQueue({
    config: { ...CONFIG, ...opts.config },
    transport,
    store: opts.store ?? memoryStore(),
    now: () => t,
    random: opts.random ?? (() => 0.5),
  });
  /** Lets time pass as the loop would, until `n` messages went out (or nothing is left). */
  async function sendNext(n = 1) {
    const sent: string[] = [];
    for (let guard = 0; guard < 200 && sent.length < n; guard++) {
      const r = await queue.step();
      if (r.sent) sent.push(r.sent);
      else if (queue.items.length === 0) break;
      else t += r.waitMs;
    }
    return sent;
  }
  return { queue, transport, events, sendNext, now: () => t, advance: (ms: number) => (t += ms) };
}

describe("the outbound queue", () => {
  it("waits a random 8–25 seconds between messages and shows “typing…” before each", async () => {
    const randoms = [0, 1 - 1e-9];
    const { queue, events, now, advance } = setup({ random: () => randoms.shift() ?? 0.5 });
    for (const id of ["a", "b", "c"]) queue.enqueue({ id, to: "9647700000001", text: `msg ${id}` });

    expect((await queue.step()).sent).toBe("a");
    const sentAt = now();
    const wait = (await queue.step()).waitMs;
    expect(wait).toBe(8000); // random 0 → the shortest gap
    advance(wait - 1);
    expect((await queue.step()).sent).toBeUndefined();
    advance(1);
    expect((await queue.step()).sent).toBe("b");
    expect(now() - sentAt).toBe(8000);
    expect((await queue.step()).waitMs).toBe(25_000); // random ~1 → the longest gap

    expect(events).toEqual([
      "typing 9647700000001@s.whatsapp.net",
      "send 9647700000001@s.whatsapp.net msg a",
      "typing 9647700000001@s.whatsapp.net",
      "send 9647700000001@s.whatsapp.net msg b",
    ]);
    // Every gap the queue can draw stays inside the window.
    for (const r of [0, 0.1, 0.5, 0.99, 0.999999]) {
      const gap = new OutboundQueue({ config: CONFIG, transport: setup().transport, random: () => r }).gap();
      expect(gap).toBeGreaterThanOrEqual(8000);
      expect(gap).toBeLessThanOrEqual(25_000);
    }
  });

  it("sends replies first, then booking messages, then promotions", async () => {
    const { queue, sendNext } = setup();
    queue.enqueue({ id: "promo-1", kind: "promo", to: "9647700000001", text: "offer" });
    queue.enqueue({ id: "booking-1", kind: "booking", to: "9647700000002", text: "confirmed" });
    const reply = queue.reply("123@lid", "thanks");
    expect(await sendNext(3)).toEqual([reply.id, "booking-1", "promo-1"]);
  });

  it("keeps booking messages and promotions under the hourly and daily caps; replies don't count", async () => {
    const { queue, sendNext, now, advance } = setup();
    for (let i = 0; i < 8; i++) queue.enqueue({ id: `m${i}`, kind: "promo", to: `96477000000${10 + i}`, text: "offer" });
    const first = now();
    expect(await sendNext(3)).toEqual(["m0", "m1", "m2"]);
    advance((await queue.step()).waitMs); // the usual gap after a message
    // The hour's three are used: the next waits until the first is an hour old.
    const r = await queue.step();
    expect(r.sent).toBeUndefined();
    expect(now() + r.waitMs).toBe(first + HOUR);
    // Someone writes meanwhile: the reply still goes out.
    const reply = queue.reply("9647711111111@s.whatsapp.net", "help");
    advance(30_000);
    expect((await queue.step()).sent).toBe(reply.id);

    expect(await sendNext(2)).toEqual(["m3", "m4"]);
    expect(queue.counts().today).toBe(5);
    advance((await queue.step()).waitMs);
    // The day's five are used: nothing more until midnight in Baghdad.
    const tomorrow = startOfDay(now(), "Asia/Baghdad") + 24 * HOUR;
    const w = await queue.step();
    expect(now() + w.waitMs).toBe(tomorrow);
    advance(w.waitMs);
    expect(await sendNext(1)).toEqual(["m5"]);
  });

  it("the same id twice is one message, before and after it is sent", async () => {
    const { queue, transport, sendNext } = setup();
    expect(queue.enqueue({ id: "x", to: "9647700000001", text: "hi" })).toMatchObject({ state: "queued", position: 1 });
    expect(queue.enqueue({ id: "x", to: "9647700000001", text: "hi" })).toMatchObject({ state: "queued", position: 1 });
    expect(queue.items).toHaveLength(1);
    await sendNext();
    expect(queue.enqueue({ id: "x", to: "9647700000001", text: "hi" })).toMatchObject({ state: "sent" });
    expect(queue.items).toHaveLength(0);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(queue.status(["x", "y"])).toMatchObject({ x: { state: "sent" }, y: { state: "unknown" } });
  });

  it("never sends to a number that isn't on WhatsApp", async () => {
    const { queue, transport } = setup();
    queue.enqueue({ id: "x", to: "15550000000", text: "hi" });
    expect(await queue.step()).toMatchObject({ failed: "x" });
    expect(queue.status(["x"]).x).toMatchObject({ state: "failed", error: "not_on_whatsapp" });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("pauses after repeated errors, then resumes by itself", async () => {
    const { queue, transport, advance, now } = setup();
    transport.send.mockRejectedValue(new Error("timed out"));
    for (const id of ["a", "b", "c"]) queue.enqueue({ id, to: "9647700000001", text: id });
    for (let i = 0; i < 3; i++) {
      await queue.step();
      advance(25_000);
    }
    expect(queue.paused).toMatchObject({ reason: "consecutive_errors" });
    const until = queue.paused!.until!;
    expect(until).toBeGreaterThan(now());
    // A message that failed twice is given up; the others wait.
    expect(queue.status(["a"]).a).toMatchObject({ state: "failed", error: "send_failed" });
    expect((await queue.step()).sent).toBeUndefined();

    transport.send.mockResolvedValue(undefined);
    advance(until - now());
    expect((await queue.step()).sent).toBe("b");
    expect(queue.paused).toBeNull();
  });

  it("a sign that WhatsApp restricts the number stops everything until someone resumes", async () => {
    const { queue, transport, advance } = setup();
    transport.send.mockRejectedValueOnce(Object.assign(new Error("rate-overlimit"), { output: { statusCode: 429 } }));
    queue.enqueue({ id: "a", to: "9647700000001", text: "a" });
    await queue.step();
    expect(queue.paused).toEqual({ reason: "ban_signal", until: null });
    expect(queue.items.map((i) => i.id)).toEqual(["a"]); // kept, not counted as a try
    // A weaker reason never replaces it, and time alone doesn't lift it.
    queue.pause("consecutive_errors", Date.now());
    expect(queue.paused?.reason).toBe("ban_signal");
    advance(48 * HOUR);
    expect((await queue.step()).sent).toBeUndefined();

    queue.resume();
    expect((await queue.step()).sent).toBe("a");
  });

  it("recognizes WhatsApp's refusals", () => {
    expect(isBanSignal({ output: { statusCode: 403 } })).toBe(true);
    expect(isBanSignal({ output: { statusCode: 401 } })).toBe(true);
    expect(isBanSignal(new Error("rate-overlimit"))).toBe(true);
    expect(isBanSignal(new Error("socket hang up"))).toBe(false);
    expect(isBanSignal({ output: { statusCode: 408 } })).toBe(false);
  });

  it("drops what waits for a stopped campaign or for someone who asked to stop", () => {
    const { queue } = setup();
    queue.enqueue({ id: "p1", kind: "promo", to: "9647700000001", text: "a" });
    queue.enqueue({ id: "p2", kind: "promo", to: "9647700000001", text: "b" });
    queue.enqueue({ id: "b1", kind: "booking", to: "9647700000002", text: "c" });
    const reply = queue.reply("9647700000002@s.whatsapp.net", "ok");
    expect(queue.cancel(["p1", "nope"], "campaign_stopped")).toEqual(["p1"]);
    expect(queue.dropFor("9647700000002")).toEqual(["b1"]);
    expect(queue.status(["p1", "p2", "b1"])).toMatchObject({
      p1: { state: "cancelled", error: "campaign_stopped" },
      p2: { state: "queued" },
      b1: { state: "opted_out" },
    });
    expect(queue.items.map((i) => i.id)).toEqual(["p2", reply.id]); // the reply to "stop" still goes
  });

  it("is kept on the volume: a restart loses no message and doesn't lift a pause", async () => {
    const store = memoryStore();
    const first = setup({ store });
    first.queue.enqueue({ id: "a", to: "9647700000001", text: "a" });
    first.queue.pause("ban_signal");
    await first.queue.persist();
    const second = setup({ store });
    await second.queue.restore();
    expect(second.queue.items.map((i) => i.id)).toEqual(["a"]);
    expect(second.queue.paused).toEqual({ reason: "ban_signal", until: null });
  });

  it("waits while WhatsApp isn't connected, and refuses more than it may hold", async () => {
    const { queue, transport } = setup({ config: { maxQueue: 2 } });
    transport.ready = false;
    queue.enqueue({ id: "a", to: "9647700000001", text: "a" });
    expect(await queue.step()).toEqual({ waitMs: 2000 });
    expect(transport.send).not.toHaveBeenCalled();
    queue.enqueue({ id: "b", to: "9647700000001", text: "b" });
    expect(() => queue.enqueue({ id: "c", to: "9647700000001", text: "c" })).toThrow(QueueFullError);
  });

  it("counts the day from midnight in Baghdad", () => {
    // 23:30 UTC on the 13th is 02:30 on the 14th in Baghdad (UTC+3).
    expect(startOfDay(Date.UTC(2026, 10, 13, 23, 30), "Asia/Baghdad")).toBe(Date.UTC(2026, 10, 13, 21, 0));
    expect(startOfDay(Date.UTC(2026, 10, 14, 20, 59), "Asia/Baghdad")).toBe(Date.UTC(2026, 10, 13, 21, 0));
  });
});

describe("reading incoming messages", () => {
  const NOW = Date.UTC(2026, 10, 14, 9, 0, 0);
  const msg = (key: Record<string, unknown>, message: unknown, ageMs = 0) => ({ key, message, messageTimestamp: Math.floor((NOW - ageMs) / 1000) });
  const person = { remoteJid: "9647700000001@s.whatsapp.net", fromMe: false, id: "1" };

  it("ignores groups, broadcasts, channels, its own messages, anything but text, and old messages", () => {
    const text = { conversation: "ABCD-EFGH" };
    expect(classify(msg({ ...person, fromMe: true }, text), { now: NOW })).toMatchObject({ action: "ignore", reason: "outgoing" });
    for (const jid of ["120363025555555555@g.us", "status@broadcast", "1203630@newsletter", "13135550002@bot"]) {
      expect(classify(msg({ ...person, remoteJid: jid }, text), { now: NOW })).toMatchObject({ action: "ignore", reason: "not_a_person" });
    }
    expect(classify(msg(person, { imageMessage: { caption: "ABCD-EFGH" } }), { now: NOW })).toMatchObject({ action: "ignore", reason: "not_text" });
    expect(classify(msg(person, { reactionMessage: { text: "👍" } }), { now: NOW })).toMatchObject({ action: "ignore", reason: "not_text" });
    expect(classify(msg(person, text, 3 * HOUR), { now: NOW })).toMatchObject({ action: "ignore", reason: "old" });
    // Baileys may give the time as a protobuf Long.
    const long = { toNumber: () => Math.floor((NOW - 3 * HOUR) / 1000) };
    expect(classify({ key: person, message: text, messageTimestamp: long }, { now: NOW })).toMatchObject({ action: "ignore", reason: "old" });
    expect(classify(msg(person, null), { now: NOW })).toMatchObject({ action: "ignore", reason: "empty" });
  });

  it("forwards codes and requests to stop; answers anything else with the help text", () => {
    expect(classify(msg(person, { conversation: "رمزي abcd efgh" }), { now: NOW })).toMatchObject({ action: "forward", kind: "code" });
    expect(classify(msg(person, { extendedTextMessage: { text: "ABCD-EFGH" } }), { now: NOW })).toMatchObject({ action: "forward", kind: "code" });
    // Disappearing-message chats wrap the text.
    expect(classify(msg(person, { ephemeralMessage: { message: { conversation: "ABCD-EFGH" } } }), { now: NOW })).toMatchObject({ kind: "code" });
    for (const stop of ["0", "٠", "STOP", "إلغاء", "الغاء", " Stop. "]) {
      expect(classify(msg(person, { conversation: stop }), { now: NOW })).toMatchObject({ action: "forward", kind: "stop" });
    }
    expect(classify(msg(person, { conversation: "مرحبا، عندي سؤال" }), { now: NOW })).toEqual({ action: "help", chat: person.remoteJid });
    expect(textOf({ viewOnceMessageV2: { message: { conversation: "hi" } } })).toBe("hi");
  });

  it("finds only code-shaped tokens from the code alphabet, and stop words alone", () => {
    expect(findCode("abcd-efgh")).toBe("ABCD-EFGH");
    expect(findCode("رمز: ٢٣٤٥ ABCD")).toBe("2345-ABCD");
    expect(findCode("ABCD-EFG0")).toBeNull(); // 0, O, 1, I and L are never in codes
    expect(findCode("OOOO-IIII")).toBeNull();
    expect(findCode("ABCDEFGHJ")).toBeNull();
    expect(isStopKeyword("0")).toBe(true);
    expect(isStopKeyword("إلغاء الاشتراك")).toBe(true);
    expect(isStopKeyword("0770 123 4567")).toBe(false);
    expect(isStopKeyword("إلغاء الحجز")).toBe(false);
  });

  it("takes the sender's real number, also behind a LID; never guesses one", async () => {
    expect(phoneOfJid("9647700000001:12@s.whatsapp.net")).toBe("9647700000001");
    expect(phoneOfJid("123456789@lid")).toBeNull();
    expect(await senderPhone({ remoteJid: "9647700000001@s.whatsapp.net" })).toBe("9647700000001");
    // Baileys 7: the alternative address on the key.
    expect(await senderPhone({ remoteJid: "201234567890123@lid", remoteJidAlt: "9647700000002@s.whatsapp.net" })).toBe("9647700000002");
    // Baileys 6.7: senderPn.
    expect(await senderPhone({ remoteJid: "201234567890123@lid", senderPn: "9647700000003@s.whatsapp.net" })).toBe("9647700000003");
    // The session's LID-to-number mapping.
    const mapping = vi.fn(async () => "9647700000004:3@s.whatsapp.net");
    expect(await senderPhone({ remoteJid: "201234567890123@lid" }, mapping)).toBe("9647700000004");
    expect(mapping).toHaveBeenCalledWith("201234567890123@lid");
    // Unknown: ignored.
    expect(await senderPhone({ remoteJid: "201234567890123@lid" }, async () => null)).toBeNull();
    expect(await senderPhone({ remoteJid: "201234567890123@lid" }, async () => Promise.reject(new Error("no session")))).toBeNull();
    expect(await senderPhone({ remoteJid: "201234567890123@lid" })).toBeNull();
  });

  it("limits how much one chat can make the bot do in an hour", () => {
    let t = 0;
    const limit = hourlyLimiter(2, () => t);
    expect([limit.allow("a"), limit.allow("a"), limit.allow("a"), limit.allow("b")]).toEqual([true, true, false, true]);
    t += HOUR;
    expect(limit.allow("a")).toBe(true);
  });
});

describe("the HTTP API the site calls", () => {
  const connected = () => ({ connection: "open", linked: true, number: "9647700000009", qrSvg: null, pairingCode: null, loggedOut: false });
  const call = (queue: OutboundQueue, method: string, path: string, body: unknown = null, auth = `Bearer ${SECRET}`, connection = connected) =>
    handle({ method, path, authorization: auth, body }, { secret: SECRET, queue, connection });

  it("answers only with the shared secret, except the health check", () => {
    const { queue } = setup();
    expect(call(queue, "GET", "/healthz", null, "")).toEqual({ status: 200, body: { ok: true } });
    expect(call(queue, "GET", "/health", null, "").status).toBe(401);
    expect(call(queue, "GET", "/health", null, `Bearer ${"x".repeat(40)}`).status).toBe(401);
    expect(call(queue, "POST", "/send", { to: "9647700000001", text: "hi" }, SECRET).status).toBe(401);
    expect(call(queue, "GET", "/health").body).toMatchObject({ connection: "open", linked: true, number: "9647700000009", queue: { total: 0 }, caps: { perHour: 3 } });
  });

  it("queues messages, checks what it is given, and refuses while WhatsApp restricts the number", () => {
    const { queue } = setup();
    expect(call(queue, "POST", "/send", { id: "m-1", to: "+9647700000001", text: "hi", kind: "promo" })).toEqual({
      status: 202,
      body: { id: "m-1", state: "queued", position: 1 },
    });
    expect(queue.items[0]).toMatchObject({ to: "9647700000001", kind: "promo" });
    expect(call(queue, "POST", "/send", { to: "07701234567", text: "hi" })).toMatchObject({ status: 400, body: { error: "invalid_number" } });
    expect(call(queue, "POST", "/send", { to: "9647700000001", text: " " })).toMatchObject({ status: 400, body: { error: "invalid_text" } });
    expect(call(queue, "POST", "/send", { id: "bad id!", to: "9647700000001", text: "hi" })).toMatchObject({ status: 400 });
    expect(call(queue, "POST", "/status", { ids: ["m-1"] }).body).toEqual({ results: { "m-1": { state: "queued" } } });
    expect(call(queue, "POST", "/cancel", { ids: ["m-1"], reason: "campaign_stopped" }).body).toEqual({ cancelled: ["m-1"] });
    expect(call(queue, "POST", "/status", { ids: "m-1" }).status).toBe(400);

    queue.pause("consecutive_errors", Date.now() + MIN);
    expect(call(queue, "POST", "/send", { to: "9647700000001", text: "hi" }).status).toBe(202); // a short pause: kept for later
    queue.pause("ban_signal");
    expect(call(queue, "POST", "/send", { to: "9647700000001", text: "hi" })).toMatchObject({ status: 503, body: { error: "paused", reason: "ban_signal" } });
    expect(call(queue, "POST", "/resume").body).toEqual({ paused: null });
    expect(queue.paused).toBeNull();
  });

  it("refuses more than the queue may hold", () => {
    const { queue } = setup({ config: { maxQueue: 1 } });
    expect(call(queue, "POST", "/send", { to: "9647700000001", text: "a" }).status).toBe(202);
    expect(call(queue, "POST", "/send", { to: "9647700000001", text: "b" })).toMatchObject({ status: 503, body: { error: "queue_full" } });
  });

  it("shows the QR code or the pairing code only while the number isn't linked", () => {
    const { queue } = setup();
    const unlinked = (extra: object) => () => ({ ...connected(), linked: false, connection: "connecting", ...extra });
    expect(call(queue, "GET", "/link", null, `Bearer ${SECRET}`, unlinked({ qrSvg: "<svg/>" })).body).toEqual({ state: "qr", qrSvg: "<svg/>" });
    expect(call(queue, "GET", "/link", null, `Bearer ${SECRET}`, unlinked({ pairingCode: "ABCD1234" })).body).toEqual({ state: "pairing", pairingCode: "ABCD1234" });
    expect(call(queue, "GET", "/link", null, `Bearer ${SECRET}`, unlinked({ loggedOut: true })).body).toEqual({ state: "logged_out" });
    expect(call(queue, "GET", "/link").body).toEqual({ state: "linked" });
  });
});

describe("forwarding to the site", () => {
  const ok = (reply: string) => new Response(JSON.stringify({ reply }), { status: 200, headers: { "Content-Type": "application/json" } });
  const base = { siteUrl: "https://al-malab.example", secret: SECRET, from: "9647700000001", sleep: async () => undefined };

  it("posts the number and text with the secret, and returns the site's reply", async () => {
    const fetchImpl = vi.fn(async () => ok("✅ تم"));
    expect(await forwardToSite({ ...base, text: "x".repeat(600), fetchImpl })).toBe("✅ تم");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://al-malab.example/api/whatsapp/webhook");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(init.body))).toEqual({ from: "9647700000001", text: "x".repeat(500) });
  });

  it("tries again after a server error, but not after a refusal", async () => {
    const flaky = vi.fn().mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValueOnce(ok("again"));
    expect(await forwardToSite({ ...base, text: "ABCD-EFGH", fetchImpl: flaky })).toBe("again");
    expect(flaky).toHaveBeenCalledTimes(2);
    const refused = vi.fn(async () => new Response("", { status: 401 }));
    expect(await forwardToSite({ ...base, text: "ABCD-EFGH", fetchImpl: refused })).toBeNull();
    expect(refused).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => Promise.reject(new Error("ECONNREFUSED")));
    expect(await forwardToSite({ ...base, text: "ABCD-EFGH", fetchImpl: down, tries: 3 })).toBeNull();
    expect(down).toHaveBeenCalledTimes(3);
  });
});

describe("the bot's settings", () => {
  it("needs a long secret and the site's https address; pacing has safe defaults", () => {
    const { config, problems } = readConfig({ WHATSAPP_BOT_SECRET: SECRET, SITE_URL: "https://al-malab.vercel.app/ar" });
    expect(problems).toEqual([]);
    expect(config).toMatchObject({
      siteUrl: "https://al-malab.vercel.app",
      minDelayMs: 8000,
      maxDelayMs: 25_000,
      maxPerHour: 30,
      maxPerDay: 200,
      dataDir: "/data",
      port: 8080,
      pairingNumber: null,
    });
    expect(readConfig({ WHATSAPP_BOT_SECRET: "short", SITE_URL: "http://al-malab.example" }).problems).toHaveLength(2);
    expect(readConfig({ WHATSAPP_BOT_SECRET: SECRET, SITE_URL: "x.vercel.app", SEND_MIN_DELAY_SECONDS: "30" }).problems).toEqual([
      "SEND_MIN_DELAY_SECONDS must not be more than SEND_MAX_DELAY_SECONDS",
    ]);
    expect(readConfig({ WHATSAPP_BOT_SECRET: SECRET, SITE_URL: "x.vercel.app", WA_PAIRING_NUMBER: "+964 770 123 4567" }).config.pairingNumber).toBe("9647701234567");
    expect(siteOrigin("http://localhost:3000/ar")).toBe("http://localhost:3000");
  });
});
