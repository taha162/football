import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc } from "./helpers";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => {
  const c = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
const ticketHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const phone = () => `9647${String(randomInt(1e9)).padStart(9, "0")}`;
/** A Telegram user id (positive, up to 52 bits). */
const tgUser = () => randomInt(1, 2 ** 47);

/** Unconfirmed auth user with an internal phone-account address, as the sign-up action creates. */
async function pendingUser(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `tg_${id.replace(/-/g, "")}@phone.malaab.invalid`;
  await admin(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', '{"display_name":"TG Player"}', '{"provider":"email","providers":["email"]}', now(), now())`,
    [id, email],
  );
  return { id, email };
}

async function start(purpose: "signup" | "reset", userId: string | null, clientKey = randomUUID()) {
  const c = code();
  const hash = ticketHash();
  await admin("select public.phone_verify_start($1, $2, $3, $4, $5)", [purpose, c, hash, userId, clientKey]);
  return { code: c, hash };
}

const link = async (c: string, tgUserId: number) =>
  (await admin<{ r: Record<string, unknown> }>("select public.tg_link_code($1, $2) as r", [c, tgUserId]))[0].r;

const contact = async (tgUserId: number, number: string) =>
  (await admin<{ r: Record<string, unknown> }>("select public.tg_receive_contact($1, $2) as r", [tgUserId, number]))[0].r;

/** The whole bot conversation: open the start link, then share the contact. */
async function verifyWithTelegram(c: string, number: string, tgUserId = tgUser()) {
  expect(await link(c, tgUserId)).toMatchObject({ linked: true });
  return contact(tgUserId, number);
}

const status = async (hash: string) =>
  (await admin<{ status: string; phone: string | null; linked: boolean }>("select * from public.phone_verify_lookup($1)", [hash]))[0];

describe("Phone verification with Telegram", () => {
  it("is callable only by the server, never through the API roles", async () => {
    const user = await createUser();
    for (const sql of [
      "select public.tg_link_code('ABCD-EFGH', 1)",
      "select public.tg_receive_contact(1, '9647700000000')",
      "select public.auth_email_for_phone('9647700000000')",
      "select * from public.phone_verify_lookup('00')",
      "select * from public.phone_verify_consume('00')",
      "select public.phone_verify_cleanup()",
    ]) {
      expect(await errorOf(asUser(user, sql))).toMatch(/permission denied/);
      expect(await errorOf(asUser(null, sql))).toMatch(/permission denied/);
    }
    expect(await errorOf(asUser(user, "select * from public.phone_verifications"))).toMatch(/permission denied/);
    expect(await errorOf(asUser(user, "select * from private.user_phones"))).toMatch(/permission denied/);
  });

  it("verifies a sign-up with the number Telegram shares, activates the account and hands off once", async () => {
    const user = await pendingUser();
    const { code: c, hash } = await start("signup", user.id);
    const from = phone();
    const me = tgUser();

    expect(await link("ZZZZ-ZZZZ", me)).toMatchObject({ linked: false, reason: "no_pending_code" });
    // Sharing a contact before opening the start link matches nothing.
    expect(await contact(me, from)).toMatchObject({ matched: false, reason: "no_pending_code" });
    expect((await status(hash)).linked).toBe(false);
    expect(await link(c.toLowerCase(), me)).toMatchObject({ linked: true, purpose: "signup" });
    expect((await status(hash)).linked).toBe(true);

    // Telegram may send the number with a "+".
    expect(await contact(me, `+${from}`)).toMatchObject({ matched: true, purpose: "signup", status: "verified" });
    // A repeated delivery of the same contact gets the same answer.
    expect(await contact(me, from)).toMatchObject({ matched: true, repeat: true, status: "verified" });

    expect(await status(hash)).toMatchObject({ status: "verified", phone: from });
    const [u] = await admin<{ email_confirmed_at: string | null }>("select email_confirmed_at from auth.users where id = $1", [user.id]);
    expect(u.email_confirmed_at).not.toBeNull();
    expect(await rpc(user.id, "my_phone")).toBe(from);
    expect((await admin<{ e: string }>("select public.auth_email_for_phone($1) as e", [from]))[0].e).toBe(user.email);

    const [handoff] = await admin<{ email: string; purpose: string }>("select * from public.phone_verify_consume($1)", [hash]);
    expect(handoff).toMatchObject({ email: user.email, purpose: "signup" });
    expect(await errorOf(admin("select * from public.phone_verify_consume($1)", [hash]))).toBe("verification_not_ready");
  });

  it("a code belongs to the Telegram account that opened it first", async () => {
    const user = await pendingUser();
    const { code: c, hash } = await start("signup", user.id);
    const owner = tgUser();
    const other = tgUser();
    expect(await link(c, owner)).toMatchObject({ linked: true });
    expect(await link(c, owner)).toMatchObject({ linked: true }); // opening the link again is fine
    expect(await link(c, other)).toMatchObject({ linked: false, reason: "claimed" });
    // The other account's contact completes nothing.
    expect(await contact(other, phone())).toMatchObject({ matched: false, reason: "no_pending_code" });
    expect((await status(hash)).status).toBe("pending");
  });

  it("refuses a number that already belongs to another account", async () => {
    const first = await pendingUser();
    const from = phone();
    await verifyWithTelegram((await start("signup", first.id)).code, from);

    const second = await pendingUser();
    const b = await start("signup", second.id);
    expect(await verifyWithTelegram(b.code, from)).toMatchObject({ matched: true, status: "phone_taken" });
    expect(await status(b.hash)).toMatchObject({ status: "phone_taken" });
    const [u] = await admin<{ email_confirmed_at: string | null }>("select email_confirmed_at from auth.users where id = $1", [second.id]);
    expect(u.email_confirmed_at).toBeNull();
    expect(await errorOf(admin("select * from public.phone_verify_consume($1)", [b.hash]))).toBe("verification_not_ready");
  });

  it("password reset identifies the account by the shared number", async () => {
    const user = await pendingUser();
    const from = phone();
    await verifyWithTelegram((await start("signup", user.id)).code, from);

    const unknown = await start("reset", null);
    expect(await verifyWithTelegram(unknown.code, phone())).toMatchObject({ matched: true, purpose: "reset", status: "no_account" });

    const known = await start("reset", null);
    expect(await verifyWithTelegram(known.code, from)).toMatchObject({ matched: true, purpose: "reset", status: "verified" });
    const [handoff] = await admin<{ email: string; user_id: string }>("select * from public.phone_verify_consume($1)", [known.hash]);
    expect(handoff).toMatchObject({ email: user.email, user_id: user.id });
  });

  it("ignores expired codes and rejects malformed numbers and senders", async () => {
    const user = await pendingUser();
    const v = await start("signup", user.id);
    const me = tgUser();
    expect(await link(v.code, 0)).toMatchObject({ linked: false, reason: "invalid_sender" });
    expect(await link(v.code, me)).toMatchObject({ linked: true });
    expect(await contact(me, "not-a-number")).toMatchObject({ matched: false, reason: "invalid_phone" });
    await admin("update public.phone_verifications set expires_at = now() - interval '1 minute' where ticket_hash = $1", [v.hash]);
    expect(await contact(me, phone())).toMatchObject({ matched: false, reason: "no_pending_code" });
    expect(await link(v.code, tgUser())).toMatchObject({ linked: false, reason: "no_pending_code" });
  });

  it("only starts sign-up verifications for unconfirmed accounts", async () => {
    const confirmed = await createUser();
    expect(await errorOf(start("signup", confirmed))).toBe("invalid_user");
    expect(await errorOf(start("reset", confirmed))).toBe("invalid_user");
  });

  it("limits unfinished verifications per client; finished ones free the slot", async () => {
    const client = randomUUID();
    await admin("update public.platform_settings set value = '2' where key = 'verify.max_open_per_hour'");
    try {
      const first = await start("reset", null, client);
      await start("reset", null, client);
      expect(await errorOf(start("reset", null, client))).toBe("rate_limited");
      await start("reset", null, randomUUID()); // other clients are unaffected

      // Someone on the same connection finishes theirs: the next person can start.
      const owner = await pendingUser();
      const from = phone();
      await verifyWithTelegram((await start("signup", owner.id)).code, from);
      expect(await verifyWithTelegram(first.code, from)).toMatchObject({ status: "verified" });
      await start("reset", null, client);
      expect(await errorOf(start("reset", null, client))).toBe("rate_limited");
    } finally {
      await admin("update public.platform_settings set value = '20' where key = 'verify.max_open_per_hour'");
    }
  });

  it("limits how many codes one Telegram account may try", async () => {
    const guesser = tgUser();
    await admin("update public.platform_settings set value = '3' where key = 'telegram.max_codes_per_hour'");
    try {
      for (let i = 0; i < 3; i++) expect(await link(code(), guesser)).toMatchObject({ linked: false, reason: "no_pending_code" });
      const user = await pendingUser();
      const real = await start("signup", user.id);
      expect(await link(real.code, guesser)).toMatchObject({ linked: false, reason: "rate_limited" });
      expect(await link(real.code, tgUser())).toMatchObject({ linked: true }); // others are unaffected
    } finally {
      await admin("update public.platform_settings set value = '20' where key = 'telegram.max_codes_per_hour'");
    }
  });

  it("cleanup removes never-verified sign-ups but keeps verified accounts", async () => {
    const abandoned = await pendingUser();
    const orphan = await pendingUser(); // its verification row is already gone
    const kept = await pendingUser();
    const a = await start("signup", abandoned.id);
    const k = await start("signup", kept.id);
    await verifyWithTelegram(k.code, phone());
    await admin("update public.phone_verifications set created_at = now() - interval '2 days', expires_at = now() - interval '2 days' where ticket_hash in ($1, $2)", [a.hash, k.hash]);
    await admin("update auth.users set created_at = now() - interval '2 days' where id in ($1, $2, $3)", [abandoned.id, orphan.id, kept.id]);
    await admin("select public.phone_verify_cleanup()");
    expect(await admin("select 1 from auth.users where id = $1", [abandoned.id])).toHaveLength(0);
    expect(await admin("select 1 from auth.users where id = $1", [orphan.id])).toHaveLength(0);
    expect(await admin("select 1 from auth.users where id = $1", [kept.id])).toHaveLength(1);
    expect(await admin("select 1 from public.phone_verifications where ticket_hash in ($1, $2)", [a.hash, k.hash])).toHaveLength(0);
  });
});
