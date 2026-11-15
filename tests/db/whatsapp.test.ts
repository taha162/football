import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, localTime, mosul, rpc, rpcRows } from "./helpers";

/**
 * WhatsApp through the platform's own number (migration 0028): verification
 * by sending the code from one's own WhatsApp, stopping messages, booking
 * messages queued by a trigger, promotional campaigns and the worker's queue.
 * Calls made "as the server" use the superuser connection, like service_role.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => {
  const c = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
const ticketHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const phone = () => `9647${String(randomInt(1e9)).padStart(9, "0")}`;

async function pendingUser(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `wa_${id.replace(/-/g, "")}@phone.malaab.invalid`;
  await admin(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', '{"display_name":"WA Player"}', '{"provider":"email","providers":["email"]}', now(), now())`,
    [id, email],
  );
  return { id, email };
}

/** Starts a verification; `typed` is the number typed on the site (WhatsApp, since 0029). */
async function start(purpose: "signup" | "reset", userId: string | null, typed: string | null = null) {
  const c = code();
  const hash = ticketHash();
  await admin("select public.phone_verify_start($1, $2, $3, $4, $5, $6)", [purpose, c, hash, userId, randomUUID(), typed]);
  return { code: c, hash };
}

type Answer = { matched?: boolean; reason?: string; purpose?: string; status?: string; repeat?: boolean; claimed?: string };
const receive = async (from: string, body: string) =>
  (await admin<{ r: Answer }>("select public.wa_bot_receive($1, $2) as r", [from, body]))[0].r;

/** For a sender WhatsApp hides: the number the code was requested for. */
const claimedFor = async (body: string) =>
  (await admin<{ r: { found: boolean; phone?: string | null; reason?: string } }>("select public.wa_bot_claimed_phone($1) as r", [body]))[0].r;

const verification = async (hash: string) =>
  (await admin<{ status: string; phone: string | null; claimed_phone: string | null }>(
    "select status, phone, claimed_phone from public.phone_verify_lookup($1)",
    [hash],
  ))[0];

const attemptsOf = async (from: string) =>
  Number(
    (await admin<{ n: string }>("select count(*) as n from private.rate_events where bucket = 'wa_code' and user_id = md5('wa_code:' || $1)::uuid", [from]))[0].n,
  );

const setSetting = (key: string, value: unknown) =>
  admin("update public.platform_settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);

/** A signed-up player whose number was verified (superuser fixture: what a verification leaves behind). */
async function playerWithPhone(name = "Player", cityId?: string): Promise<{ id: string; phone: string }> {
  const id = await createUser(name);
  const number = phone();
  await admin("insert into private.user_phones (user_id, phone) values ($1, $2)", [id, number]);
  if (cityId) await admin("update public.profiles set city_id = $2 where id = $1", [id, cityId]);
  return { id, phone: number };
}

const messagesOf = (userId: string) =>
  admin<{ id: string; kind: string; status: string; error: string | null; payload: Record<string, unknown>; phone: string }>(
    "select id, kind, status, error, payload, phone from public.outbound_messages where user_id = $1 order by created_at",
    [userId],
  );

describe("WhatsApp verification: the user sends the code from their own number", () => {
  it("is callable only by the server, never through the API roles", async () => {
    const user = await createUser();
    for (const sql of [
      "select public.wa_bot_receive('9647700000000', 'ABCD-EFGH')",
      "select public.wa_bot_claimed_phone('ABCD-EFGH')",
      `select public.phone_verify_start('reset', 'ABCD-EFGH', '${"0".repeat(64)}', null, 'x', '9647700000000')`,
      `select * from public.phone_verify_lookup('${"0".repeat(64)}')`,
      "select public.wa_bot_unsubscribe('9647700000000')",
      `select public.wa_signup_consent('${user}', true)`,
      "select * from public.wa_outbox_claim(1)",
      "select public.wa_outbox_handed('[]')",
      "select * from public.wa_outbox_in_flight(1)",
      "select public.wa_outbox_delivered('[]')",
      "select public.wa_outbox_cleanup()",
    ]) {
      expect(await errorOf(asUser(user, sql))).toMatch(/permission denied/);
      expect(await errorOf(asUser(null, sql))).toMatch(/permission denied/);
    }
    for (const table of ["outbound_messages", "whatsapp_campaigns"]) {
      expect(await errorOf(asUser(user, `select * from public.${table}`))).toMatch(/permission denied/);
      expect(await errorOf(asUser(null, `select * from public.${table}`))).toMatch(/permission denied/);
    }
    expect(await errorOf(asUser(user, `insert into public.whatsapp_consent (user_id, opted_in_at) values ('${user}', now())`))).toMatch(
      /permission denied/,
    );
  });

  it("verifies a sign-up in one message, from the sender's number, and hands off once", async () => {
    const user = await pendingUser();
    const { code: c, hash } = await start("signup", user.id);
    const from = phone();
    // The code may come in other text, in small letters, with a space instead of the dash.
    const typed = `رمزي ${c.toLowerCase().replace("-", " ")} شكراً`;
    expect(await receive(`+${from}`, typed)).toEqual({ matched: true, purpose: "signup", status: "verified" });

    expect(await verification(hash)).toMatchObject({ status: "verified", phone: from });
    const [u] = await admin<{ email_confirmed_at: string | null; phone: string | null }>("select email_confirmed_at, phone from auth.users where id = $1", [user.id]);
    expect(u.email_confirmed_at).not.toBeNull();
    expect(u.phone).toBe(from);
    expect((await admin<{ phone: string }>("select phone from private.user_phones where user_id = $1", [user.id]))[0].phone).toBe(from);

    const [handoff] = await admin<{ email: string; purpose: string }>("select * from public.phone_verify_consume($1)", [hash]);
    expect(handoff).toMatchObject({ email: user.email, purpose: "signup" });
    expect(await errorOf(admin("select * from public.phone_verify_consume($1)", [hash]))).toBe("verification_not_ready");
  });

  it("a repeated delivery of the same message gets the same answer and costs no attempt", async () => {
    const user = await pendingUser();
    const { code: c } = await start("signup", user.id);
    const from = phone();
    expect(await receive(from, c)).toMatchObject({ matched: true, status: "verified" });
    const before = await attemptsOf(from);
    expect(await receive(from, c)).toEqual({ matched: true, repeat: true, purpose: "signup", status: "verified" });
    expect(await receive(from, c)).toMatchObject({ repeat: true, status: "verified" });
    expect(await attemptsOf(from)).toBe(before);
    // Someone else sending a code that was already used learns nothing about it.
    expect(await receive(phone(), c)).toEqual({ matched: false, reason: "no_pending_code" });
  });

  it("wrong, expired or malformed codes match nothing; only the code alphabet counts", async () => {
    const user = await pendingUser();
    const v = await start("signup", user.id);
    const from = phone();
    expect(await receive(from, code())).toEqual({ matched: false, reason: "no_pending_code" });
    // 0, O, 1, I and L never appear in codes, so tokens with them are not codes.
    for (const body of ["ABCD-EFG0", "OOOO-IIII", "L1L1-0O0O", "hello", "ABCDEFGHJ", ""]) {
      expect(await receive(from, body)).toEqual({ matched: false, reason: "no_code" });
    }
    expect(await receive("12", v.code)).toEqual({ matched: false, reason: "invalid_sender" });
    await admin("update public.phone_verifications set expires_at = now() - interval '1 minute' where ticket_hash = $1", [v.hash]);
    expect(await receive(from, v.code)).toEqual({ matched: false, reason: "no_pending_code" });
    expect((await verification(v.hash)).status).toBe("pending");
  });

  it("refuses a number that already belongs to another account", async () => {
    const first = await pendingUser();
    const from = phone();
    expect(await receive(from, (await start("signup", first.id)).code)).toMatchObject({ status: "verified" });

    const second = await pendingUser();
    const b = await start("signup", second.id);
    expect(await receive(from, b.code)).toEqual({ matched: true, purpose: "signup", status: "phone_taken" });
    expect(await receive(from, b.code)).toMatchObject({ repeat: true, status: "phone_taken" });
    expect((await verification(b.hash)).status).toBe("phone_taken");
    const [u] = await admin<{ email_confirmed_at: string | null }>("select email_confirmed_at from auth.users where id = $1", [second.id]);
    expect(u.email_confirmed_at).toBeNull();
    expect(await errorOf(admin("select * from public.phone_verify_consume($1)", [b.hash]))).toBe("verification_not_ready");
  });

  it("password reset: the sender's number finds the account", async () => {
    const user = await pendingUser();
    const from = phone();
    await receive(from, (await start("signup", user.id)).code);

    const unknown = await start("reset", null);
    expect(await receive(phone(), unknown.code)).toEqual({ matched: true, purpose: "reset", status: "no_account" });

    const known = await start("reset", null);
    expect(await receive(from, known.code)).toEqual({ matched: true, purpose: "reset", status: "verified" });
    const [handoff] = await admin<{ email: string; user_id: string }>("select * from public.phone_verify_consume($1)", [known.hash]);
    expect(handoff).toMatchObject({ email: user.email, user_id: user.id });
  });

  it("a code requested for a typed number counts only from that number", async () => {
    const user = await pendingUser();
    const typed = phone();
    const v = await start("signup", user.id, `+${typed}`);
    expect(await verification(v.hash)).toMatchObject({ status: "pending", claimed_phone: typed });
    // From another number: refused, and it stays open for the typed one.
    const other = phone();
    expect(await receive(other, v.code)).toEqual({ matched: false, reason: "other_number", claimed: typed });
    expect(await verification(v.hash)).toMatchObject({ status: "pending", phone: null });
    expect(await receive(typed, v.code)).toEqual({ matched: true, purpose: "signup", status: "verified" });
    expect(await verification(v.hash)).toMatchObject({ status: "verified", phone: typed, claimed_phone: typed });
    // The same for a password reset: someone typing another person's number gets nowhere.
    const reset = await start("reset", null, typed);
    expect(await receive(other, reset.code)).toMatchObject({ matched: false, reason: "other_number" });
    expect(await receive(typed, reset.code)).toEqual({ matched: true, purpose: "reset", status: "verified" });
  });

  it("for a sender WhatsApp hides, it says which number the code was requested for", async () => {
    const user = await pendingUser();
    const typed = phone();
    const v = await start("signup", user.id, typed);
    expect(await claimedFor(`رمزي ${v.code.toLowerCase()}`)).toEqual({ found: true, phone: typed });
    // After the check (the bot then calls wa_bot_receive with that number), and for the same message again.
    expect(await receive(typed, v.code)).toMatchObject({ status: "verified" });
    expect(await claimedFor(v.code)).toEqual({ found: true, phone: typed });
    expect(await receive(typed, v.code)).toMatchObject({ repeat: true, status: "verified" });
    // Unknown or expired codes, and messages without a code: nothing.
    expect(await claimedFor(code())).toEqual({ found: false });
    expect(await claimedFor("hello")).toEqual({ found: false });
    const late = await start("reset", null, typed);
    await admin("update public.phone_verifications set expires_at = now() - interval '1 minute' where ticket_hash = $1", [late.hash]);
    expect(await claimedFor(late.code)).toEqual({ found: false });
    // Started without a typed number (before 0029): no number to check.
    const untyped = await start("reset", null);
    expect(await claimedFor(untyped.code)).toEqual({ found: true, phone: null });
  });

  it("refuses a typed number that isn't one", async () => {
    for (const bad of ["123", "abc", "0770123456789012345"]) {
      expect(await errorOf(start("reset", null, bad))).toBe("invalid_phone");
    }
    // Spaces, dashes and a "+" are fine.
    const ok = await start("reset", null, "+964 770-123-4567");
    expect((await verification(ok.hash)).claimed_phone).toBe("9647701234567");
  });

  it("limits how many codes one number may try per hour", async () => {
    const guesser = phone();
    await setSetting("whatsapp.max_codes_per_hour", 3);
    try {
      for (let i = 0; i < 3; i++) expect(await receive(guesser, code())).toEqual({ matched: false, reason: "no_pending_code" });
      const user = await pendingUser();
      const real = await start("signup", user.id);
      expect(await receive(guesser, real.code)).toEqual({ matched: false, reason: "rate_limited" });
      expect(await receive(phone(), real.code)).toMatchObject({ matched: true, status: "verified" }); // others are unaffected
    } finally {
      await setSetting("whatsapp.max_codes_per_hour", 20);
    }
  });
});

describe("Who receives WhatsApp messages", () => {
  it("promotions need an explicit opt-in; Settings switches both kinds", async () => {
    const user = await createUser();
    const consent = async () =>
      (await asUser<{ opted_in_at: string | null; opted_out_at: string | null; bookings_off_at: string | null }>(user, "select * from public.whatsapp_consent"))[0];
    expect(await consent()).toBeUndefined();

    await rpc(user, "set_my_whatsapp_settings", { p_bookings: true, p_promos: false });
    expect(await consent()).toMatchObject({ opted_in_at: null, opted_out_at: null, bookings_off_at: null });
    await rpc(user, "set_my_whatsapp_settings", { p_bookings: true, p_promos: true });
    const optedIn = await consent();
    expect(optedIn.opted_in_at).not.toBeNull();
    await rpc(user, "set_my_whatsapp_settings", { p_bookings: false, p_promos: false });
    expect(await consent()).toMatchObject({ opted_in_at: optedIn.opted_in_at });
    expect((await consent()).opted_out_at).not.toBeNull();
    expect((await consent()).bookings_off_at).not.toBeNull();

    // Nobody reads anyone else's consent.
    expect(await asUser(await createUser(), "select * from public.whatsapp_consent where user_id = $1", [user])).toEqual([]);
  });

  it("the box on the phone sign-up forms is recorded for the account being created only", async () => {
    const pending = await pendingUser();
    await admin("select public.wa_signup_consent($1, true)", [pending.id]);
    const [row] = await admin<{ opted_in_at: string | null }>("select opted_in_at from public.whatsapp_consent where user_id = $1", [pending.id]);
    expect(row.opted_in_at).not.toBeNull();
    // An unticked box records nothing, and an existing account can't be signed up this way.
    const other = await pendingUser();
    await admin("select public.wa_signup_consent($1, false)", [other.id]);
    expect(await admin("select 1 from public.whatsapp_consent where user_id = $1", [other.id])).toHaveLength(0);
    expect(await errorOf(admin("select public.wa_signup_consent($1, true)", [await createUser()]))).toBe("invalid_user");
  });

  it("“0”, “stop” or «إلغاء» stops everything for that number at once", async () => {
    const p = await playerWithPhone();
    await rpc(p.id, "set_my_whatsapp_settings", { p_bookings: true, p_promos: true });
    // Superuser fixture: a booking message waiting for this number.
    await admin("insert into public.outbound_messages (user_id, phone, kind, payload) values ($1, $2, 'booking', '{}')", [p.id, p.phone]);

    expect((await admin<{ r: Record<string, unknown> }>("select public.wa_bot_unsubscribe($1) as r", [`+${p.phone}`]))[0].r).toEqual({
      ok: true,
      known: true,
      dropped: 1,
    });
    const [c] = await admin<{ opted_out_at: string | null; bookings_off_at: string | null }>("select * from public.whatsapp_consent where user_id = $1", [p.id]);
    expect(c.opted_out_at).not.toBeNull();
    expect(c.bookings_off_at).not.toBeNull();
    expect(await messagesOf(p.id)).toMatchObject([{ status: "skipped", error: "opted_out" }]);
    expect((await admin<{ r: Record<string, unknown> }>("select public.wa_bot_unsubscribe($1) as r", [phone()]))[0].r).toMatchObject({ ok: true, known: false });
  });
});

/** A verified venue taking platform bookings with a 5,000 IQD deposit (as in bookings.test.ts). */
async function venue() {
  const owner = await createUser("Owner");
  const id = await rpc<string>(owner, "create_venue", { p_name: `WhatsApp Pitch ${owner.slice(0, 5)}`, p_city_id: await mosul() });
  const field = await rpc<string>(owner, "upsert_venue_field", {
    p_venue_id: id,
    p_field_id: null,
    p_name: "Field 1",
    p_surface: "artificial_turf",
    p_formats: "{5v5}",
    p_is_covered: false,
    p_has_lights: true,
    p_price_per_hour: 30_000,
  });
  await rpc(owner, "set_venue_opening_hours", {
    p_venue_id: id,
    p_hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "02:00" })),
  });
  await rpc(await createUser("Mod", { admin: true }), "admin_set_venue_verification", { p_venue_id: id, p_status: "verified" });
  const [v] = await admin<Record<string, unknown>>("select * from public.venues where id = $1", [id]);
  await rpc(owner, "update_venue", {
    p_venue_id: id,
    p_name: v.name,
    p_city_id: v.city_id,
    p_booking_mode: "platform",
    p_auto_confirm: false,
    p_buffer_minutes: 0,
    p_min_notice_minutes: 0,
    p_cancellation_deadline_hours: 12,
  });
  await rpc(owner, "set_venue_deposit_instructions", { p_venue_id: id, p_instructions: "ZainCash 0770 000 0000" });
  return { owner, id, field, name: v.name as string };
}

const book = (user: string, field: string, day: number, hour: number) =>
  rpc<{ booking_id: string }>(user, "request_booking", { p_field_id: field, p_start_local: localTime(day, hour), p_duration_minutes: 60 });

describe("Booking messages on WhatsApp", () => {
  let v: Awaited<ReturnType<typeof venue>>;
  beforeAll(async () => {
    v = await venue();
    await setSetting("whatsapp.booking_messages", true);
  });
  afterAll(async () => {
    await setSetting("whatsapp.booking_messages", false);
  });

  it("confirming queues one message with a snapshot of the booking; cancelling queues a short one", async () => {
    const p = await playerWithPhone();
    const { booking_id } = await book(p.id, v.field, 3, 18);
    expect(await messagesOf(p.id)).toEqual([]); // waiting for the deposit is not a confirmation

    await rpc(v.owner, "decide_booking", { p_booking_id: booking_id, p_approve: true });
    const [confirmed] = await messagesOf(p.id);
    expect(confirmed).toMatchObject({
      kind: "booking",
      status: "queued",
      phone: p.phone,
      payload: { event: "confirmed", booking_id, venue_name: v.name, price_total: 30_000, currency: "IQD", deposit_amount: 5000, deposit_status: "received" },
    });
    expect(confirmed.payload.field_name).toBeNull(); // one field: no court name

    await rpc(p.id, "cancel_booking", { p_booking_id: booking_id });
    const after = await messagesOf(p.id);
    expect(after).toHaveLength(2);
    // The confirmation that was still waiting gives way to the cancellation.
    expect(after[0]).toMatchObject({ status: "skipped", error: "superseded" });
    expect(after[1]).toMatchObject({ status: "queued", payload: { event: "cancelled", booking_id, by_customer: true } });
  });

  it("nothing is queued without a verified number, for people who turned it off, or with the setting off", async () => {
    const noPhone = await createUser();
    const off = await playerWithPhone();
    await rpc(off.id, "set_my_whatsapp_settings", { p_bookings: false, p_promos: false });
    const later = await playerWithPhone();
    for (const [user, hour] of [[noPhone, 10], [off.id, 12]] as const) {
      const { booking_id } = await book(user, v.field, 4, hour);
      await rpc(v.owner, "decide_booking", { p_booking_id: booking_id, p_approve: true });
      expect(await messagesOf(user)).toEqual([]);
    }
    await setSetting("whatsapp.booking_messages", false);
    try {
      const { booking_id } = await book(later.id, v.field, 4, 14);
      await rpc(v.owner, "decide_booking", { p_booking_id: booking_id, p_approve: true });
      expect(await messagesOf(later.id)).toEqual([]);
    } finally {
      await setSetting("whatsapp.booking_messages", true);
    }
  });

  it("a WhatsApp failure never breaks the booking", async () => {
    const p = await playerWithPhone();
    const { booking_id } = await book(p.id, v.field, 5, 18);
    // Superuser fixture: make every new message row fail to insert.
    await admin("alter table public.outbound_messages add constraint wa_test_refuse check (phone = 'never') not valid");
    try {
      await rpc(v.owner, "decide_booking", { p_booking_id: booking_id, p_approve: true });
    } finally {
      await admin("alter table public.outbound_messages drop constraint wa_test_refuse");
    }
    expect((await admin<{ status: string }>("select status from public.bookings where id = $1", [booking_id]))[0].status).toBe("confirmed");
    expect(await messagesOf(p.id)).toEqual([]);
  });
});

/** An inactive city of the test's own, so a campaign's audience is exactly the test's players. */
const newCity = async () =>
  (
    await admin<{ id: string }>(
      "insert into public.cities (slug, name_en, name_ar, country_code, timezone, currency, is_active) values ($1, 'WA Test', 'اختبار', 'IQ', 'Asia/Baghdad', 'IQD', false) returning id",
      [`wa-test-${randomUUID().slice(0, 8)}`],
    )
  )[0].id;

describe("Promotions and the sending queue", () => {
  let boss: string;
  beforeAll(async () => {
    boss = await createUser("Boss", { admin: true });
    // Another run's campaign left sending would block this file's (one at a time).
    await admin("update public.whatsapp_campaigns set status = 'stopped', stopped_at = now() where status = 'sending'");
  });

  /** Only this test's messages are due (superuser fixture: earlier rows are set aside). */
  async function isolate() {
    await admin("update public.whatsapp_campaigns set status = 'stopped', stopped_at = now() where status = 'sending'");
    await admin("update public.outbound_messages set status = 'skipped', error = 'test_isolation' where status in ('queued', 'sending')");
  }

  /** Today's promotional allowance set to exactly n, whatever earlier runs handed out today. */
  async function promoAllowance(n: number) {
    const [{ handed }] = await admin<{ handed: number }>(
      "select count(*)::int as handed from public.outbound_messages where kind = 'promo' and first_handed_at >= ((now() at time zone 'Asia/Baghdad')::date)::timestamp at time zone 'Asia/Baghdad'",
    );
    await setSetting("whatsapp.promo_daily_start", handed + n);
    await setSetting("whatsapp.promo_daily_step", 0);
    await setSetting("whatsapp.promo_daily_max", 1_000_000);
  }
  afterAll(async () => {
    await setSetting("whatsapp.promo_daily_start", 20);
    await setSetting("whatsapp.promo_daily_step", 10);
    await setSetting("whatsapp.promo_daily_max", 150);
  });

  const claim = (n: number) =>
    admin<{ id: string; kind: string; phone: string; recipient_name: string; campaign_body: string | null; payload: Record<string, unknown> }>(
      "select * from public.wa_outbox_claim($1)",
      [n],
    );
  const statusOf = async (id: string) =>
    (await admin<{ status: string; attempts: number; error: string | null; body: string | null }>("select status, attempts, error, body from public.outbound_messages where id = $1", [id]))[0];

  it("only admins see the audience, start, list and stop campaigns, and every campaign is audited", async () => {
    const city = await newCity();
    const optedIn = [await playerWithPhone("In", city), await playerWithPhone("In", city)];
    const notAsked = await playerWithPhone("Quiet", city);
    const optedOut = await playerWithPhone("Out", city);
    for (const p of optedIn) await rpc(p.id, "set_my_whatsapp_settings", { p_bookings: true, p_promos: true });
    await rpc(optedOut.id, "set_my_whatsapp_settings", { p_bookings: true, p_promos: true });
    await admin("select public.wa_bot_unsubscribe($1)", [optedOut.phone]);
    void notAsked;

    const player = await createUser();
    expect(await errorOf(rpc(player, "admin_whatsapp_audience"))).toMatch(/forbidden/);
    expect(await errorOf(rpc(player, "admin_start_promo_campaign", { p_body: "Hello there", p_city_id: city }))).toMatch(/forbidden/);
    expect(await errorOf(rpcRows(player, "admin_whatsapp_campaigns"))).toMatch(/forbidden/);

    const audience = await rpc<{ total: number; by_city: Record<string, number> }>(boss, "admin_whatsapp_audience");
    expect(audience.by_city[city]).toBe(2);
    expect(await errorOf(rpc(boss, "admin_start_promo_campaign", { p_body: "hey", p_city_id: city }))).toBe("invalid_message");

    const started = await rpc<{ campaign_id: string; recipients: number }>(boss, "admin_start_promo_campaign", { p_body: "ملعب جديد افتتح اليوم", p_city_id: city });
    expect(started.recipients).toBe(2);
    expect(await errorOf(rpc(boss, "admin_start_promo_campaign", { p_body: "Another one", p_city_id: city }))).toBe("campaign_in_progress");
    const recipients = await admin<{ user_id: string }>("select user_id from public.outbound_messages where campaign_id = $1", [started.campaign_id]);
    expect(recipients.map((r) => r.user_id).sort()).toEqual(optedIn.map((p) => p.id).sort());

    const [listed] = (await rpcRows<{ id: string; status: string; recipients: number; queued: number }>(boss, "admin_whatsapp_campaigns")).filter((c) => c.id === started.campaign_id);
    expect(listed).toMatchObject({ status: "sending", recipients: 2, queued: 2 });

    expect(await errorOf(rpc(player, "admin_stop_promo_campaign", { p_campaign_id: started.campaign_id }))).toMatch(/forbidden/);
    expect(await rpc(boss, "admin_stop_promo_campaign", { p_campaign_id: started.campaign_id })).toEqual({ skipped: 2, in_flight: [] });
    expect(await errorOf(rpc(boss, "admin_stop_promo_campaign", { p_campaign_id: started.campaign_id }))).toBe("campaign_not_active");
    const audit = await admin<{ action: string; actor_id: string; details: Record<string, unknown> }>(
      "select action, actor_id, details from public.audit_logs where entity_id = $1 order by id",
      [started.campaign_id],
    );
    expect(audit).toMatchObject([
      { action: "whatsapp_campaign_started", actor_id: boss, details: { recipients: 2, city_id: city } },
      { action: "whatsapp_campaign_stopped", actor_id: boss, details: { skipped: 2, with_bot: 0 } },
    ]);
  });

  it("hands booking messages first, then promotions within today's limit, and records what the bot reports", async () => {
    await isolate();
    const city = await newCity();
    const fans = await Promise.all([1, 2, 3, 4].map(() => playerWithPhone("Fan", city)));
    for (const f of fans) await rpc(f.id, "set_my_whatsapp_settings", { p_bookings: true, p_promos: true });
    const { campaign_id } = await rpc<{ campaign_id: string }>(boss, "admin_start_promo_campaign", { p_body: "عرض خاص هذا الأسبوع", p_city_id: city });
    const booker = await playerWithPhone("Booker");
    await admin(
      "insert into public.outbound_messages (user_id, phone, kind, payload) values ($1, $2, 'booking', jsonb_build_object('event', 'confirmed', 'starts_at', now() + interval '1 day'))",
      [booker.id, booker.phone],
    );
    await promoAllowance(2);

    const first = await claim(10);
    expect(first.map((m) => m.kind)).toEqual(["booking", "promo", "promo"]);
    expect(first[1]).toMatchObject({ campaign_body: "عرض خاص هذا الأسبوع" });
    expect(first[1].recipient_name).toMatch(/^Fan/);
    expect(await claim(10)).toEqual([]); // today's limit is used up; the rest wait for tomorrow

    // The bot took the booking message and one promotion; it was unreachable for the other.
    const [bookingMsg, promoA, promoB] = first;
    await admin("select public.wa_outbox_handed($1)", [
      JSON.stringify([
        { id: bookingMsg.id, outcome: "accepted", body: "تم تأكيد حجزك" },
        { id: promoA.id, outcome: "accepted", body: "مرحباً" },
        { id: promoB.id, outcome: "later" },
      ]),
    ]);
    expect(await statusOf(bookingMsg.id)).toMatchObject({ status: "sending", body: "تم تأكيد حجزك", attempts: 1 });
    expect(await statusOf(promoB.id)).toMatchObject({ status: "queued", attempts: 0 });
    const inFlight = (await admin<{ id: string }>("select * from public.wa_outbox_in_flight(50) as id")).map((r) => r.id);
    expect(inFlight.sort()).toEqual([bookingMsg.id, promoA.id].sort());

    // The bot reports: the booking message went out; the promotion failed for now.
    await admin("select public.wa_outbox_delivered($1)", [
      JSON.stringify([
        { id: bookingMsg.id, state: "sent", at: new Date().toISOString() },
        { id: promoA.id, state: "failed", error: "send_failed" },
      ]),
    ]);
    expect(await statusOf(bookingMsg.id)).toMatchObject({ status: "sent", error: null });
    expect(await statusOf(promoA.id)).toMatchObject({ status: "queued", error: "send_failed", attempts: 1 });

    // "Unknown" to the bot right after the handover means another run is still handing it over: no change.
    // Minutes later it means the bot lost it (a restart without its volume): it is handed again.
    await admin("select public.wa_outbox_delivered($1)", [JSON.stringify([{ id: bookingMsg.id, state: "unknown" }])]);
    expect(await statusOf(bookingMsg.id)).toMatchObject({ status: "sent" }); // already settled: nothing changes
    await admin("update public.outbound_messages set status = 'sending', handed_at = now() where id = $1", [promoB.id]);
    await admin("select public.wa_outbox_delivered($1)", [JSON.stringify([{ id: promoB.id, state: "unknown" }])]);
    expect(await statusOf(promoB.id)).toMatchObject({ status: "sending" });
    await admin("update public.outbound_messages set handed_at = now() - interval '3 minutes' where id = $1", [promoB.id]);
    await admin("select public.wa_outbox_delivered($1)", [JSON.stringify([{ id: promoB.id, state: "unknown" }])]);
    expect(await statusOf(promoB.id)).toMatchObject({ status: "queued", error: "lost" });

    // A number that isn't on WhatsApp fails for good; tries are limited.
    await setSetting("whatsapp.max_attempts", 1);
    try {
      await admin("update public.outbound_messages set status = 'sending', handed_at = now() where id = $1", [promoA.id]);
      await admin("select public.wa_outbox_delivered($1)", [JSON.stringify([{ id: promoA.id, state: "failed", error: "send_failed" }])]);
      expect(await statusOf(promoA.id)).toMatchObject({ status: "failed" });
    } finally {
      await setSetting("whatsapp.max_attempts", 3);
    }

    // Someone who opts out before their turn is skipped, and stopping skips the rest.
    await admin("select public.wa_bot_unsubscribe($1)", [fans[3].phone]);
    const stopped = await rpc<{ skipped: number }>(boss, "admin_stop_promo_campaign", { p_campaign_id: campaign_id });
    expect(stopped.skipped).toBeGreaterThanOrEqual(1);
    const report = (await rpcRows<{ id: string; status: string; sent: number; failed: number; skipped: number; queued: number }>(boss, "admin_whatsapp_campaigns")).find(
      (c) => c.id === campaign_id,
    );
    expect(report).toMatchObject({ status: "stopped", sent: 0, failed: 1, queued: 0 });
    expect(report!.skipped).toBe(3);
  });

  it("skips booking messages that are no longer useful, and messages to numbers no longer verified", async () => {
    await isolate();
    const late = await playerWithPhone();
    const gone = await playerWithPhone();
    await admin(
      "insert into public.outbound_messages (user_id, phone, kind, payload) values ($1, $2, 'booking', jsonb_build_object('starts_at', now() - interval '1 hour'))",
      [late.id, late.phone],
    );
    await admin(
      "insert into public.outbound_messages (user_id, phone, kind, payload) values ($1, $2, 'booking', jsonb_build_object('starts_at', now() + interval '1 day'))",
      [gone.id, gone.phone],
    );
    await admin("delete from private.user_phones where user_id = $1", [gone.id]);
    expect(await claim(10)).toEqual([]);
    expect(await messagesOf(late.id)).toMatchObject([{ status: "skipped", error: "stale" }]);
    expect(await messagesOf(gone.id)).toMatchObject([{ status: "skipped", error: "no_phone" }]);
  });
});
