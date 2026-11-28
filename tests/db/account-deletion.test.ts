import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, mosul, rpc } from "./helpers";

/**
 * Members delete their own account (migration 0050): only after the site
 * checked the password (allow_account_deletion, server key only), with the
 * second step when they have one; never an admin of the site or a venue's
 * owner. What goes is what an admin's deletion takes (0030).
 */

type Result = { deleted: boolean; files: Record<string, string[]> };
const deleteMine = (actor: Parameters<typeof asUser>[0], reason: string | null = null) =>
  asUser<{ r: Result }>(actor, "select public.delete_my_account($1) as r", [reason]).then((rows) => rows[0].r);
/** The site, after the password: the server's own connection. */
const allow = (id: string) => admin("select public.allow_account_deletion($1)", [id]);
const exists = async (id: string) => (await admin("select 1 from auth.users where id = $1", [id])).length === 1;

describe("deleting one's own account", () => {
  it("needs the password check first, then takes the account, its messages and files, and records it", async () => {
    const [me, friend] = [await createUser("Leaving"), await createUser("Stays")];
    const conv = await rpc<string>(me, "start_direct_conversation", { p_user_id: friend });
    await rpc(me, "send_message", { p_conversation_id: conv, p_body: "وداعاً" });
    await admin("update public.profiles set avatar_path = $2 where id = $1", [me, `${me}/face.jpg`]);

    // A session alone: refused, and only the server may allow it.
    expect(await errorOf(deleteMine(me))).toMatch(/password_check_required/);
    expect(await errorOf(asUser(me, "select public.allow_account_deletion($1)", [me]))).toMatch(/permission denied/);
    expect(await exists(me)).toBe(true);

    const preview = await rpc<{ admin: boolean; owns_venues: string[]; messages: number }>(me, "my_account_deletion_preview");
    expect(preview).toMatchObject({ admin: false, owns_venues: [], messages: 1 });

    await allow(me);
    const result = await deleteMine(me, "لم أعد ألعب");
    expect(result.deleted).toBe(true);
    expect(result.files.avatars).toEqual([`${me}/face.jpg`]);
    expect(await exists(me)).toBe(false);
    expect(await admin("select 1 from public.profiles where id = $1", [me])).toHaveLength(0);
    expect(await admin("select 1 from public.messages where conversation_id = $1", [conv])).toHaveLength(0);
    const [log] = await admin<{ details: { reason: string; messages: number } }>(
      "select details from public.audit_logs where action = 'account.self_deleted' and entity_id = $1",
      [me],
    );
    expect(log.details).toMatchObject({ reason: "لم أعد ألعب", messages: 1 });
    // The other member keeps their account.
    expect(await exists(friend)).toBe(true);
  });

  it("the permission lasts a few minutes and serves once", async () => {
    const me = await createUser("Late");
    await allow(me);
    await admin("update private.account_deletion_grants set expires_at = now() - interval '1 second' where user_id = $1", [me]);
    expect(await errorOf(deleteMine(me))).toMatch(/password_check_required/);
    expect(await exists(me)).toBe(true);
  });

  it("with an authenticator app, the second step is needed too", async () => {
    const me = await createUser("Two steps");
    await admin(
      "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values ($1, $2, 'phone', 'totp', 'verified', now(), now())",
      [randomUUID(), me],
    );
    await allow(me);
    expect(await errorOf(deleteMine({ id: me, aal: "aal1" }))).toMatch(/mfa_required/);
    expect(await exists(me)).toBe(true);
    await allow(me);
    expect((await deleteMine({ id: me, aal: "aal2" })).deleted).toBe(true);
  });

  it("an admin of the site and a venue's owner can't, and say why", async () => {
    const boss = await createUser("Boss", { admin: true });
    await allow(boss);
    expect((await rpc<{ admin: boolean }>(boss, "my_account_deletion_preview")).admin).toBe(true);
    expect(await errorOf(deleteMine(boss))).toMatch(/admin_account/);

    const owner = await createUser("Owner");
    await rpc<string>(owner, "create_venue", { p_name: `Pitch ${owner.slice(0, 5)}`, p_city_id: await mosul() });
    expect((await rpc<{ owns_venues: string[] }>(owner, "my_account_deletion_preview")).owns_venues).toHaveLength(1);
    await allow(owner);
    expect(await errorOf(deleteMine(owner))).toMatch(/owns_venue/);
    expect(await exists(boss)).toBe(true);
    expect(await exists(owner)).toBe(true);
  });

  it("visitors can't", async () => {
    expect(await errorOf(deleteMine(null))).toMatch(/permission denied/);
  });
});
