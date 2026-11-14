/**
 * The bot's one outbound queue. Everything the bot sends goes through it:
 * replies to people who wrote to the number, booking messages and
 * promotions, in that order. Between two messages it waits a random
 * 8–25 seconds and shows "typing…" first. Booking messages and promotions
 * stay under hourly and daily caps; replies don't count, since the person
 * wrote first. Repeated errors pause it for a while; signs that WhatsApp is
 * restricting the number pause it until someone resumes it. Its state is
 * kept on the volume, so a restart loses nothing and doesn't lift a pause.
 *
 * Pure apart from what is injected (clock, randomness, transport, store), so
 * it is unit-tested with a fake clock (tests/unit/whatsapp-bot.test.ts).
 */

export const PRIORITY = { reply: 0, booking: 1, promo: 2 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEEP_DONE_MS = 7 * DAY;
/** A pause for a stronger reason is never replaced by a weaker one. */
const PAUSE_RANK = { consecutive_errors: 1, logged_out: 2, ban_signal: 3 };

export class QueueFullError extends Error {
  constructor() {
    super("queue_full");
    this.name = "QueueFullError";
  }
}

/**
 * Signs that WhatsApp is restricting this number (refused, rate-limited,
 * logged out, "reach-out" locked): stop sending until a person looks.
 * @param {unknown} err
 */
export function isBanSignal(err) {
  const e = /** @type {{ output?: { statusCode?: number }, statusCode?: number, status?: number, message?: string } | null} */ (err);
  const code = Number(e?.output?.statusCode ?? e?.statusCode ?? e?.status);
  if ([401, 403, 405, 429, 463].includes(code)) return true;
  return /rate-overlimit|not-authorized|forbidden|banned|blocked|restricted|reachout|timelock/i.test(String(e?.message ?? ""));
}

/**
 * Midnight of the day `ms` falls in, in a time zone, as epoch milliseconds.
 * @param {number} ms
 * @param {string} timeZone
 */
export function startOfDay(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = asUtc - Math.floor(ms / 1000) * 1000;
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset;
}

/**
 * @typedef {"reply" | "booking" | "promo"} Kind
 * @typedef {{ id: string, kind: Kind, to: string, jid: string | null, text: string, at: number, tries: number }} Item
 * @typedef {{ state: "sent" | "failed" | "cancelled" | "opted_out", error?: string, at: number }} Done
 * @typedef {{
 *   isReady(): boolean,
 *   lookup(phone: string): Promise<string | null>,
 *   typing(jid: string, ms: number): Promise<void>,
 *   send(jid: string, text: string): Promise<void>,
 * }} Transport
 * @typedef {{
 *   minDelayMs: number, maxDelayMs: number, maxPerHour: number, maxPerDay: number,
 *   maxConsecutiveErrors: number, pauseMinutes: number, maxQueue: number, timeZone: string,
 * }} QueueConfig
 */

export class OutboundQueue {
  /**
   * @param {{
   *   config: QueueConfig,
   *   transport: Transport,
   *   store?: { load(): Promise<any>, save(data: unknown): Promise<void> } | null,
   *   now?: () => number,
   *   random?: () => number,
   *   log?: (event: string, meta?: Record<string, unknown>) => void,
   * }} deps
   */
  constructor({ config, transport, store = null, now = Date.now, random = Math.random, log = () => {} }) {
    this.config = config;
    this.transport = transport;
    this.store = store;
    this.now = now;
    this.random = random;
    this.log = log;
    /** @type {Item[]} waiting messages */
    this.items = [];
    /** @type {Map<string, Done>} what became of messages, kept a week */
    this.done = new Map();
    /** @type {number[]} times of capped sends (booking messages and promotions), last 24 hours */
    this.sends = [];
    /** No message before this time (the random gap after the previous one). */
    this.nextAt = 0;
    /** Failures in a row. */
    this.errors = 0;
    /** @type {{ reason: string, until: number | null } | null} */
    this.paused = null;
    this.dirty = false;
    this.running = false;
    /** @type {Promise<void> | null} */
    this.loop = null;
  }

  async restore() {
    const saved = await this.store?.load();
    if (!saved) return;
    this.items = Array.isArray(saved.items) ? saved.items : [];
    this.done = new Map(Array.isArray(saved.done) ? saved.done : []);
    this.sends = Array.isArray(saved.sends) ? saved.sends : [];
    this.paused = saved.paused ?? null;
    this.prune();
  }

  async persist() {
    if (!this.store || !this.dirty) return;
    this.dirty = false;
    await this.store.save({ items: this.items, done: [...this.done], sends: this.sends, paused: this.paused });
  }

  prune() {
    const t = this.now();
    for (const [id, d] of this.done) if (t - d.at > KEEP_DONE_MS) this.done.delete(id);
    this.sends = this.sends.filter((s) => t - s < DAY);
  }

  /** @param {Item} item */
  position(item) {
    return this.ordered().indexOf(item) + 1;
  }

  ordered() {
    return [...this.items].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.at - b.at);
  }

  /**
   * Adds a message. The same id twice is the same message: the answer is its current state.
   * @param {{ id?: string, kind?: Kind, to: string, jid?: string | null, text: string }} msg
   */
  enqueue({ id, kind = "booking", to, jid = null, text }) {
    if (id) {
      const waiting = this.items.find((i) => i.id === id);
      if (waiting) return { id, state: "queued", position: this.position(waiting) };
      const known = this.done.get(id);
      if (known) return { id, ...known };
    }
    if (this.items.length >= this.config.maxQueue) throw new QueueFullError();
    /** @type {Item} */
    const item = { id: id ?? `reply-${this.now()}-${Math.floor(this.random() * 1e9)}`, kind, to, jid, text, at: this.now(), tries: 0 };
    this.items.push(item);
    this.dirty = true;
    return { id: item.id, state: "queued", position: this.position(item) };
  }

  /**
   * A reply to someone who wrote: first in line, and not counted against the caps.
   * @param {string} jid the chat it came from
   * @param {string} text
   */
  reply(jid, text) {
    return this.enqueue({ kind: "reply", to: jid, jid, text });
  }

  /** @param {string[]} ids */
  status(ids) {
    /** @type {Record<string, { state: string, error?: string, at?: string }>} */
    const out = {};
    for (const id of ids) {
      if (this.items.some((i) => i.id === id)) out[id] = { state: "queued" };
      else {
        const d = this.done.get(id);
        out[id] = d ? { state: d.state, ...(d.error ? { error: d.error } : {}), at: new Date(d.at).toISOString() } : { state: "unknown" };
      }
    }
    return out;
  }

  /**
   * @param {Item} item
   * @param {Done["state"]} state
   * @param {string} [error]
   */
  finish(item, state, error) {
    this.items = this.items.filter((i) => i !== item);
    this.done.set(item.id, { state, ...(error ? { error } : {}), at: this.now() });
    this.dirty = true;
  }

  /**
   * Drops messages that haven't gone out yet (a stopped campaign).
   * @param {string[]} ids
   * @param {string} [reason]
   */
  cancel(ids, reason = "cancelled") {
    const wanted = new Set(ids);
    const out = [];
    for (const item of [...this.items]) {
      if (item.kind !== "reply" && wanted.has(item.id)) {
        this.finish(item, "cancelled", reason);
        out.push(item.id);
      }
    }
    return out;
  }

  /**
   * The person asked to stop: every booking message and promotion still waiting for them goes.
   * @param {string} phone
   */
  dropFor(phone) {
    const out = [];
    for (const item of [...this.items]) {
      if (item.kind !== "reply" && item.to === phone) {
        this.finish(item, "opted_out");
        out.push(item.id);
      }
    }
    return out;
  }

  /**
   * @param {"consecutive_errors" | "logged_out" | "ban_signal"} reason
   * @param {number | null} [until] resumes by itself then; null waits for a person
   */
  pause(reason, until = null) {
    if (this.paused && (PAUSE_RANK[/** @type {keyof typeof PAUSE_RANK} */ (this.paused.reason)] ?? 0) > PAUSE_RANK[reason]) return;
    this.paused = { reason, until };
    this.dirty = true;
    this.log("sending_paused", { reason, until: until ? new Date(until).toISOString() : null });
  }

  resume() {
    if (!this.paused) return;
    this.paused = null;
    this.errors = 0;
    this.dirty = true;
    this.log("sending_resumed");
  }

  /** @param {string} reason */
  resumeIf(reason) {
    if (this.paused?.reason === reason) this.resume();
  }

  /** Capped sends in the last hour, and since midnight in Baghdad. */
  counts() {
    const t = this.now();
    const midnight = startOfDay(t, this.config.timeZone);
    return { lastHour: this.sends.filter((s) => t - s < HOUR).length, today: this.sends.filter((s) => s >= midnight).length };
  }

  summary() {
    const by = { reply: 0, booking: 0, promo: 0 };
    for (const i of this.items) by[i.kind] += 1;
    return {
      queue: { total: this.items.length, replies: by.reply, booking: by.booking, promo: by.promo },
      sent: this.counts(),
      caps: { perHour: this.config.maxPerHour, perDay: this.config.maxPerDay },
      paused: this.paused ? { reason: this.paused.reason, until: this.paused.until ? new Date(this.paused.until).toISOString() : null } : null,
    };
  }

  /** How long until a capped message may go: 0 now, else until the hourly or daily window frees. */
  capWait() {
    const t = this.now();
    const { lastHour, today } = this.counts();
    if (today >= this.config.maxPerDay) return startOfDay(t, this.config.timeZone) + DAY - t;
    if (lastHour >= this.config.maxPerHour) {
      const inHour = this.sends.filter((s) => t - s < HOUR).sort((a, b) => a - b);
      return inHour[lastHour - this.config.maxPerHour] + HOUR - t;
    }
    return 0;
  }

  /** A random gap between two messages, from minDelayMs to maxDelayMs. */
  gap() {
    const { minDelayMs, maxDelayMs } = this.config;
    return minDelayMs + Math.floor(this.random() * (maxDelayMs - minDelayMs + 1));
  }

  /** "typing…" for about as long as a person would take, 1.2 to 6 seconds. @param {string} text */
  typingMs(text) {
    return Math.min(6000, 1200 + text.length * 35);
  }

  /**
   * Does the next thing that is due, and says how long until something else
   * could be (the loop sleeps that long, a second at most at a time).
   * @returns {Promise<{ sent?: string, failed?: string, waitMs: number }>}
   */
  async step() {
    const t = this.now();
    if (this.paused) {
      if (this.paused.until !== null && t >= this.paused.until) this.resume();
      else return { waitMs: this.paused.until !== null ? this.paused.until - t : 60_000 };
    }
    if (this.items.length === 0) return { waitMs: 1000 };
    if (!this.transport.isReady()) return { waitMs: 2000 };
    if (t < this.nextAt) return { waitMs: this.nextAt - t };
    const item = this.ordered()[0];
    if (item.kind !== "reply") {
      const wait = this.capWait();
      if (wait > 0) return { waitMs: wait };
    }
    try {
      let jid = item.jid;
      if (!jid) {
        jid = await this.transport.lookup(item.to);
        if (!jid) {
          // Sending to numbers that aren't on WhatsApp looks like spam: never tried again.
          this.finish(item, "failed", "not_on_whatsapp");
          this.nextAt = this.now() + 1000;
          return { failed: item.id, waitMs: 1000 };
        }
        item.jid = jid; // a retry needn't ask again
      }
      await this.transport.typing(jid, this.typingMs(item.text));
      await this.transport.send(jid, item.text);
      this.errors = 0;
      if (item.kind !== "reply") this.sends.push(this.now());
      this.finish(item, "sent");
      this.nextAt = this.now() + this.gap();
      return { sent: item.id, waitMs: this.nextAt - this.now() };
    } catch (err) {
      this.errors += 1;
      this.nextAt = this.now() + this.gap();
      const message = String(/** @type {{ message?: string }} */ (err)?.message ?? err).slice(0, 160);
      if (isBanSignal(err)) {
        // The message stays in line; nothing more goes out until someone resumes.
        this.pause("ban_signal");
        this.log("send_refused_by_whatsapp", { kind: item.kind, message });
        return { waitMs: 60_000 };
      }
      item.tries += 1;
      this.dirty = true;
      const gaveUp = item.tries >= 2;
      if (gaveUp) this.finish(item, "failed", "send_failed");
      if (this.errors >= this.config.maxConsecutiveErrors) this.pause("consecutive_errors", this.now() + this.config.pauseMinutes * 60_000);
      this.log("send_failed", { kind: item.kind, tries: item.tries, message });
      return { ...(gaveUp ? { failed: item.id } : {}), waitMs: this.nextAt - this.now() };
    }
  }

  /** Runs until stop(). @param {{ sleep?: (ms: number) => Promise<void> }} [opts] */
  start({ sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.running = true;
    const run = async () => {
      while (this.running) {
        let wait = 1000;
        try {
          ({ waitMs: wait } = await this.step());
        } catch (e) {
          this.log("queue_error", { message: String(/** @type {{ message?: string }} */ (e)?.message ?? e).slice(0, 160) });
        }
        await this.persist().catch((e) => this.log("queue_save_failed", { message: String(e?.message ?? e).slice(0, 160) }));
        await sleep(Math.max(50, Math.min(wait, 1000)));
      }
    };
    this.loop = run();
    return this.loop;
  }

  async stop() {
    this.running = false;
    await this.loop;
    this.dirty = true;
    await this.persist();
  }
}
