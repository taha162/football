import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc, rpcRows } from "./helpers";

/**
 * The phone verification pieces the WhatsApp flows rest on (migration 0014
 * and later): who may call them, what a verified sign-up leaves behind (the
 * number in Supabase's user list, phone sign-in), the one-time hand-off, the
 * per-client limit, the admin user list and the cleanup. Codes are completed
 * the way the bot does it: wa_bot_receive, from the number typed on the site.
 * The WhatsApp rules themselves are in whatsapp.test.ts.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => {
  const c = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
const ticketHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const phone = () => `9647${String(randomInt(1e9)).padStart(9, "0")}`;

/** Unconfirmed auth user with an internal phone-account address, as the sign-up action creates. */
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

/** Starts a verification for the number typed on the site. */
async function start(purpose: "signup" | "reset", userId: string | null, typed: string, clientKey = randomUUID()) {
  const c = code();
  const hash = ticketHash();
  await admin("select public.phone_verify_start($1, $2, $3, $4, $5, $6)", [purpose, c, hash, userId, clientKey, typed]);
  return { code: c, hash };
}

/** The code, sent from `number`'s WhatsApp. */
const send = async (c: string, number: string) =>
  (await admin<{ r: Record<string, unknown> }>("select public.wa_bot_receive($1, $2) as r", [number, c]))[0].r;

/** A verification for `number`, completed from that number's WhatsApp. */
async function verify(purpose: "signup" | "reset", userId: string | null, number: string) {
  const v = await start(purpose, userId, number);
  return { ...v, answer: await send(v.code, number) };
}

const status = async (hash: string) =>
  (await admin<{ status: string; phone: string | null }>("select * from public.phone_verify_lookup($1)", [hash]))[0];

describe("Phone verification: the pieces the WhatsApp flows rest on", () => {
  it("is callable only by the server, never through the API roles", async () => {
    const user = await createUser();
    for (const sql of [
      "select public.auth_email_for_phone('9647700000000')",
      "select * from public.phone_verify_lookup('00')",
      "select * from public.phone_verify_consume('00')",
      "select public.phone_verify_cleanup()",
      // Telegram's: still in the database, unused since Telegram sign-up was removed from the site.
      "select public.tg_link_code('ABCD-EFGH', 1)",
      "select public.tg_receive_contact(1, '9647700000000')",
    ]) {
      expect(await errorOf(asUser(user, sql))).toMatch(/permission denied/);
      expect(await errorOf(asUser(null, sql))).toMatch(/permission denied/);
    }
    expect(await errorOf(asUser(user, "select * from public.phone_verifications"))).toMatch(/permission denied/);
    expect(await errorOf(asUser(user, "select * from private.user_phones"))).toMatch(/permission denied/);
  });

  it("a verified sign-up activates the account, shows the number in Supabase, signs in by it, and hands off once", async () => {
    const user = await pendingUser();
    const from = phone();
    const { hash, answer } = await verify("signup", user.id, from);
    expect(answer).toMatchObject({ matched: true, purpose: "signup", status: "verified" });

    expect(await status(hash)).toMatchObject({ status: "verified", phone: from });
    const [u] = await admin<{ email_confirmed_at: string | null; phone: string | null; phone_confirmed_at: string | null }>(
      "select email_confirmed_at, phone, phone_confirmed_at from auth.users where id = $1",
      [user.id],
    );
    expect(u.email_confirmed_at).not.toBeNull();
    // The number also shows in Supabase's own user list.
    expect(u).toMatchObject({ phone: from });
    expect(u.phone_confirmed_at).not.toBeNull();
    expect(await rpc(user.id, "my_phone")).toBe(from);
    // Signing in with the number finds the account's internal address.
    expect((await admin<{ e: string }>("select public.auth_email_for_phone($1) as e", [from]))[0].e).toBe(user.email);

    const [handoff] = await admin<{ email: string; purpose: string }>("select * from public.phone_verify_consume($1)", [hash]);
    expect(handoff).toMatchObject({ email: user.email, purpose: "signup" });
    expect(await errorOf(admin("select * from public.phone_verify_consume($1)", [hash]))).toBe("verification_not_ready");
  });

  it("only starts sign-up verifications for unconfirmed accounts", async () => {
    const confirmed = await createUser();
    expect(await errorOf(start("signup", confirmed, phone()))).toBe("invalid_user");
    expect(await errorOf(start("reset", confirmed, phone()))).toBe("invalid_user");
  });

  it("limits unfinished verifications per client; finished ones free the slot", async () => {
    const client = randomUUID();
    await admin("update public.platform_settings set value = '2' where key = 'verify.max_open_per_hour'");
    try {
      const from = phone();
      const first = await start("reset", null, from, client);
      await start("reset", null, phone(), client);
      expect(await errorOf(start("reset", null, phone(), client))).toBe("rate_limited");
      await start("reset", null, phone(), randomUUID()); // other clients are unaffected

      // Someone on the same connection finishes theirs: the next person can start.
      const owner = await pendingUser();
      await verify("signup", owner.id, from);
      expect(await send(first.code, from)).toMatchObject({ purpose: "reset", status: "verified" });
      await start("reset", null, phone(), client);
      expect(await errorOf(start("reset", null, phone(), client))).toBe("rate_limited");
    } finally {
      await admin("update public.platform_settings set value = '20' where key = 'verify.max_open_per_hour'");
    }
  });

  it("the admin user list shows phone numbers and finds them by the local 07… form", async () => {
    const boss = await createUser("Boss", { admin: true });
    const player = await createUser();
    const user = await pendingUser();
    await admin("insert into public.profiles (id, display_name) values ($1, 'رقم') on conflict (id) do nothing", [user.id]);
    const from = phone();
    await verify("signup", user.id, from);

    const local = `0${from.slice(3, 6)} ${from.slice(6, 9)} ${from.slice(9)}`;
    const rows = await rpcRows<{ id: string; phone: string | null }>(boss, "admin_list_users", { p_search: local });
    expect(rows.find((r) => r.id === user.id)).toMatchObject({ phone: from });
    // Short or digit-less searches don't match every number.
    expect((await rpcRows<{ id: string }>(boss, "admin_list_users", { p_search: "zzzz-no-such-user" })).length).toBe(0);
    expect(await errorOf(rpcRows(player, "admin_list_users", { p_search: local }))).toMatch(/forbidden|permission|admin/);
  });

  it("cleanup removes never-verified sign-ups but keeps verified accounts", async () => {
    const abandoned = await pendingUser();
    const orphan = await pendingUser(); // its verification row is already gone
    const kept = await pendingUser();
    const a = await start("signup", abandoned.id, phone());
    const k = await verify("signup", kept.id, phone());
    await admin("update public.phone_verifications set created_at = now() - interval '2 days', expires_at = now() - interval '2 days' where ticket_hash in ($1, $2)", [a.hash, k.hash]);
    await admin("update auth.users set created_at = now() - interval '2 days' where id in ($1, $2, $3)", [abandoned.id, orphan.id, kept.id]);
    await admin("select public.phone_verify_cleanup()");
    expect(await admin("select 1 from auth.users where id = $1", [abandoned.id])).toHaveLength(0);
    expect(await admin("select 1 from auth.users where id = $1", [orphan.id])).toHaveLength(0);
    expect(await admin("select 1 from auth.users where id = $1", [kept.id])).toHaveLength(1);
    expect(await admin("select 1 from public.phone_verifications where ticket_hash in ($1, $2)", [a.hash, k.hash])).toHaveLength(0);
  });
});
