import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, notificationsOf } from "./helpers";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => {
  const c = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
const ticketHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const phone = () => `9647${String(randomInt(1e9)).padStart(9, "0")}`;

/** As the site's server starts it, for the member it checked and the number they typed. */
async function start(userId: string, typed: string) {
  const c = code();
  const hash = ticketHash();
  await admin("select public.phone_verify_start('phone_change', $1, $2, $3, $4, $5)", [c, hash, userId, randomUUID(), typed]);
  return { code: c, hash };
}
/** The code, sent from `number`'s WhatsApp (as the bot reports it). */
const send = async (c: string, number: string) =>
  (await admin<{ r: Record<string, unknown> }>("select public.wa_bot_receive($1, $2) as r", [number, c]))[0].r;
const phoneOf = async (userId: string) =>
  (await admin<{ phone: string }>("select phone from private.user_phones where user_id = $1", [userId]))[0]?.phone ?? null;
const emailForPhone = async (p: string) => (await admin<{ e: string | null }>("select public.auth_email_for_phone($1) as e", [p]))[0].e;

/** Migrations 0046–0047: a member adds or changes their number with WhatsApp. */
describe("changing one's phone number", () => {
  it("an account without a number adds one; signing in with it works; they're told", async () => {
    const me = await createUser("Adds a number");
    const number = phone();
    const v = await start(me, number);
    expect(await send(v.code, number)).toMatchObject({ matched: true, purpose: "phone_change", status: "verified" });
    expect(await phoneOf(me)).toBe(number);
    const [{ email }] = await admin<{ email: string }>("select email from auth.users where id = $1", [me]);
    expect(await emailForPhone(number)).toBe(email);
    expect((await admin("select phone from auth.users where id = $1", [me]))[0]).toEqual({ phone: number });
    const [notice] = await notificationsOf(me, "phone_changed");
    expect(notice.payload).toMatchObject({ phone_end: number.slice(-4) });
    // A security notice: switching notices off doesn't stop it.
    expect((await admin("select private.is_mandatory_notification('phone_changed') as m"))[0].m).toBe(true);
    expect(await admin("select 1 from public.audit_logs where action = 'account.phone_changed' and entity_id = $1", [me])).toHaveLength(1);
  });

  it("a new number replaces the old one, which is then free for others", async () => {
    const [me, other] = [await createUser("Changes number"), await createUser("Takes the old one")];
    const [first, second] = [phone(), phone()];
    await send((await start(me, first)).code, first);
    await send((await start(me, second)).code, second);
    expect(await phoneOf(me)).toBe(second);
    expect(await emailForPhone(first)).toBeNull();
    // Someone else may now verify the old number.
    await send((await start(other, first)).code, first);
    expect(await phoneOf(other)).toBe(first);
  });

  it("another account's number, the same number, or a code from another number change nothing", async () => {
    const [me, owner] = [await createUser("Wants a taken number"), await createUser("Owns the number")];
    const taken = phone();
    await send((await start(owner, taken)).code, taken);
    expect(await errorOf(start(me, taken))).toMatch(/phone_taken/);
    expect(await errorOf(start(owner, taken))).toMatch(/same_phone/);

    // Taken between the start and the code: the code finds it taken.
    const contested = phone();
    const v = await start(me, contested);
    await send((await start(owner, contested)).code, contested);
    expect(await send(v.code, contested)).toMatchObject({ status: "phone_taken" });
    expect(await phoneOf(me)).toBeNull();

    // The code counts only from the number typed.
    const typed = phone();
    const w = await start(me, typed);
    expect(await send(w.code, phone())).toMatchObject({ matched: false, reason: "other_number" });
    expect(await phoneOf(me)).toBeNull();
  });

  it("only for an active account, with a typed number, started by the server", async () => {
    const me = await createUser("Started properly");
    expect(await errorOf(admin("select public.phone_verify_start('phone_change', $1, $2, $3, $4, null)", [code(), ticketHash(), me, randomUUID()]))).toMatch(/invalid_user/);
    await admin("update public.profiles set status = 'suspended' where id = $1", [me]);
    expect(await errorOf(start(me, phone()))).toMatch(/invalid_user/);
    // Signed-in members can't call it themselves (the site checks their password first).
    expect(await errorOf(asUser(me, "select public.phone_verify_start('phone_change', 'ABCD-EFGH', $1, $2, 'x', '9647700000001')", [ticketHash(), me]))).toMatch(/permission denied/);
  });

  it("an e-mail change is told to the member and logged; only the server records it", async () => {
    const me = await createUser("Changes e-mail");
    await admin("select public.account_email_changed($1, 'new.address@example.com')", [me]);
    const [notice] = await notificationsOf(me, "email_changed");
    expect(notice.payload).toMatchObject({ email_hint: "n•••@example.com" });
    expect(await errorOf(asUser(me, "select public.account_email_changed($1, 'x@y.z')", [me]))).toMatch(/permission denied/);
  });
});
