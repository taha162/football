import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc } from "./helpers";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => {
  const c = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
const ticketHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const phone = () => `9647${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

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

async function start(purpose: "signup" | "reset", userId: string | null, clientKey = randomUUID()) {
  const c = code();
  const hash = ticketHash();
  await admin("select public.wa_create_verification($1, $2, $3, $4, $5)", [purpose, c, hash, userId, clientKey]);
  return { code: c, hash };
}

const receive = async (from: string, body: string, messageId = `wamid.${randomUUID()}`) =>
  (await admin<{ r: Record<string, unknown> }>("select public.wa_receive($1, $2, $3) as r", [from, body, messageId]))[0].r;

const status = async (hash: string) =>
  (await admin<{ status: string; phone: string | null }>("select * from public.wa_get_verification($1)", [hash]))[0];

describe("WhatsApp verification", () => {
  it("is callable only by the server, never through the API roles", async () => {
    const user = await createUser();
    for (const sql of [
      "select public.wa_receive('9647700000000', 'ABCD-EFGH', 'x')",
      "select public.wa_auth_email_for_phone('9647700000000')",
      "select * from public.wa_get_verification('00')",
      "select public.wa_cleanup()",
    ]) {
      expect(await errorOf(asUser(user, sql))).toMatch(/permission denied/);
      expect(await errorOf(asUser(null, sql))).toMatch(/permission denied/);
    }
    expect(await errorOf(asUser(user, "select * from public.whatsapp_verifications"))).toMatch(/permission denied/);
    expect(await errorOf(asUser(user, "select * from private.user_phones"))).toMatch(/permission denied/);
  });

  it("verifies a sign-up from the sender's number, activates the account and hands off once", async () => {
    const user = await pendingUser();
    const { code: c, hash } = await start("signup", user.id);
    const from = phone();
    const messageId = `wamid.${randomUUID()}`;

    expect(await receive(from, "hello")).toMatchObject({ matched: false, reason: "no_pending_code" });
    // Lower-case, inside other text, as WhatsApp delivers the pre-filled message.
    expect(await receive(from, `رمز التحقق في ملعب: ${c.toLowerCase()}`, messageId)).toMatchObject({ matched: true, status: "verified" });
    expect(await receive(from, c, messageId)).toMatchObject({ matched: false, reason: "duplicate" });

    expect(await status(hash)).toMatchObject({ status: "verified", phone: from });
    const [u] = await admin<{ email_confirmed_at: string | null }>("select email_confirmed_at from auth.users where id = $1", [user.id]);
    expect(u.email_confirmed_at).not.toBeNull();
    expect(await rpc(user.id, "my_phone")).toBe(from);
    expect((await admin<{ e: string }>("select public.wa_auth_email_for_phone($1) as e", [from]))[0].e).toBe(user.email);

    const [handoff] = await admin<{ email: string; purpose: string }>("select * from public.wa_consume_verification($1)", [hash]);
    expect(handoff).toMatchObject({ email: user.email, purpose: "signup" });
    expect(await errorOf(admin("select * from public.wa_consume_verification($1)", [hash]))).toBe("verification_not_ready");
  });

  it("refuses a number that already belongs to another account", async () => {
    const first = await pendingUser();
    const from = phone();
    const a = await start("signup", first.id);
    await receive(from, a.code);

    const second = await pendingUser();
    const b = await start("signup", second.id);
    expect(await receive(from, b.code)).toMatchObject({ matched: true, status: "phone_taken" });
    expect(await status(b.hash)).toMatchObject({ status: "phone_taken" });
    const [u] = await admin<{ email_confirmed_at: string | null }>("select email_confirmed_at from auth.users where id = $1", [second.id]);
    expect(u.email_confirmed_at).toBeNull();
    expect(await errorOf(admin("select * from public.wa_consume_verification($1)", [b.hash]))).toBe("verification_not_ready");
  });

  it("password reset identifies the account by the sender's number", async () => {
    const user = await pendingUser();
    const from = phone();
    await receive(from, (await start("signup", user.id)).code);

    const unknown = await start("reset", null);
    expect(await receive(phone(), unknown.code)).toMatchObject({ matched: true, purpose: "reset", status: "no_account" });

    const known = await start("reset", null);
    expect(await receive(from, known.code)).toMatchObject({ matched: true, purpose: "reset", status: "verified" });
    const [handoff] = await admin<{ email: string; user_id: string }>("select * from public.wa_consume_verification($1)", [known.hash]);
    expect(handoff).toMatchObject({ email: user.email, user_id: user.id });
  });

  it("ignores expired codes and rejects malformed senders", async () => {
    const user = await pendingUser();
    const v = await start("signup", user.id);
    expect(await receive("not-a-number", v.code)).toMatchObject({ matched: false, reason: "invalid_sender" });
    await admin("update public.whatsapp_verifications set expires_at = now() - interval '1 minute' where ticket_hash = $1", [v.hash]);
    expect(await receive(phone(), v.code)).toMatchObject({ matched: false, reason: "no_pending_code" });
  });

  it("only starts sign-up verifications for unconfirmed accounts, and rate-limits each client", async () => {
    const confirmed = await createUser();
    expect(await errorOf(start("signup", confirmed))).toBe("invalid_user");
    expect(await errorOf(start("reset", confirmed))).toBe("invalid_user");

    const client = randomUUID();
    await admin("update public.platform_settings set value = '2' where key = 'whatsapp.max_starts_per_hour'");
    try {
      await start("reset", null, client);
      await start("reset", null, client);
      expect(await errorOf(start("reset", null, client))).toBe("rate_limited");
      await start("reset", null, randomUUID()); // other clients are unaffected
    } finally {
      await admin("update public.platform_settings set value = '10' where key = 'whatsapp.max_starts_per_hour'");
    }
  });

  it("cleanup removes never-verified sign-ups but keeps verified accounts", async () => {
    const abandoned = await pendingUser();
    const kept = await pendingUser();
    const a = await start("signup", abandoned.id);
    const k = await start("signup", kept.id);
    await receive(phone(), k.code);
    await admin("update public.whatsapp_verifications set created_at = now() - interval '2 days' where ticket_hash in ($1, $2)", [a.hash, k.hash]);
    await admin("select public.wa_cleanup()");
    expect(await admin("select 1 from auth.users where id = $1", [abandoned.id])).toHaveLength(0);
    expect(await admin("select 1 from auth.users where id = $1", [kept.id])).toHaveLength(1);
  });
});
