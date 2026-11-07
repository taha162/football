import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, mosul, rpc, rpcRows } from "./helpers";

/**
 * Two-step verification (migration 0027). Once someone has a verified
 * authenticator app, a session that only passed the password ("aal1") can
 * neither read nor change anything as them; after the code ("aal2") everything
 * works as before. People without an app are unaffected.
 */

/** Superuser fixture: what Supabase Auth stores once someone confirmed their app. */
async function addFactor(userId: string, status: "verified" | "unverified" = "verified") {
  await admin(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     values ($1, $2, $3, 'totp', $4, now(), now(), 'JBSWY3DPEHPK3PXP')`,
    [randomUUID(), userId, `app ${randomUUID().slice(0, 6)}`, status],
  );
}

const password = (id: string) => ({ id, aal: "aal1" as const });
const withCode = (id: string) => ({ id, aal: "aal2" as const });

const ownProfile = async (actor: Parameters<typeof asUser>[0], id: string) =>
  (await asUser(actor, "select id from public.profiles where id = $1", [id])).length;

const profileUpdate = (id: string) => ({
  p_display_name: `Renamed ${id.slice(0, 4)}`,
  p_city_id: null as string | null,
  p_positions: "{midfielder}",
  p_skill_level: "intermediate",
  p_complete_onboarding: false,
});

describe("two-step verification is enforced by the database", () => {
  it("people without an authenticator app keep exactly the access they had", async () => {
    const user = await createUser("NoApp");
    const args = { ...profileUpdate(user), p_city_id: await mosul() };
    expect(await ownProfile(user, user)).toBe(1);
    expect(await ownProfile(password(user), user)).toBe(1);
    await expect(rpc(password(user), "update_my_profile", args)).resolves.not.toThrow();
    expect((await asUser(password(user), "select count(*)::int as n from public.cities"))[0].n).toBeGreaterThan(0);
  });

  it("an unfinished set-up (the code was never confirmed) changes nothing", async () => {
    const user = await createUser("Unfinished");
    await addFactor(user, "unverified");
    expect(await ownProfile(password(user), user)).toBe(1);
  });

  it("with an app, the password alone reads nothing, not even public lists", async () => {
    const user = await createUser("WithApp");
    await addFactor(user);
    expect(await ownProfile(password(user), user)).toBe(0);
    expect(await ownProfile(user, user)).toBe(0); // no level in the token counts as the password only
    expect((await asUser(password(user), "select count(*)::int as n from public.cities"))[0].n).toBe(0);
    expect((await asUser(password(user), "select count(*)::int as n from public.notifications"))[0].n).toBe(0);
  });

  it("with an app, the password alone changes nothing (every action refuses)", async () => {
    const user = await createUser("WithApp");
    await addFactor(user);
    const args = { ...profileUpdate(user), p_city_id: await mosul() };
    expect(await errorOf(rpc(password(user), "update_my_profile", args))).toMatch(/mfa_required/);
    expect(await errorOf(rpc(password(user), "mark_notifications_read", { p_ids: null }))).toMatch(/mfa_required/);
    const name = (await admin<{ display_name: string }>("select display_name from public.profiles where id = $1", [user]))[0].display_name;
    expect(name).not.toMatch(/^Renamed/);
  });

  it("with an app, the private reads that skip row security return nothing too", async () => {
    const user = await createUser("WithApp");
    await admin("insert into private.user_phones (user_id, phone) values ($1, $2)", [user, `9647${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`]);
    await admin("update public.profiles set show_match_history = false where id = $1", [user]);
    await admin("insert into public.notifications (user_id, type) values ($1, 'match_joined')", [user]);
    await addFactor(user);

    expect(await rpc(password(user), "my_phone")).toBeNull();
    expect(await rpcRows(password(user), "my_conversations")).toEqual([]);
    expect(await rpc(password(user), "unread_counts")).toEqual({ notifications: 0, messages: 0 });
    expect(await rpc(password(user), "player_stats", { p_user_id: user })).toBeNull();

    // After the code, the same reads answer as before.
    expect(await rpc(withCode(user), "my_phone")).toMatch(/^9647\d{9}$/);
    expect(await rpc<{ notifications: number }>(withCode(user), "unread_counts")).toMatchObject({ notifications: 1 });
    expect(await rpc(withCode(user), "player_stats", { p_user_id: user })).not.toBeNull();
  });

  it("after the code, everything works as before", async () => {
    const user = await createUser("WithApp");
    await addFactor(user);
    expect(await ownProfile(withCode(user), user)).toBe(1);
    await rpc(withCode(user), "update_my_profile", { ...profileUpdate(user), p_city_id: await mosul() });
    const name = (await admin<{ display_name: string }>("select display_name from public.profiles where id = $1", [user]))[0].display_name;
    expect(name).toMatch(/^Renamed/);
  });

  it("files (storage) follow the same rule: a picture sent in a conversation", async () => {
    const [user, friend] = [await createUser("WithApp"), await createUser("Friend")];
    const conv = await rpc<string>(user, "start_direct_conversation", { p_user_id: friend });
    const name = `${conv}/${randomUUID()}.jpg`;
    await admin("insert into storage.objects (bucket_id, name) values ('message-images', $1)", [name]);
    await addFactor(user);
    const canOpen = async (actor: Parameters<typeof asUser>[0]) =>
      (await asUser(actor, "select 1 from storage.objects where bucket_id = 'message-images' and name = $1", [name])).length === 1;
    expect(await canOpen(password(user))).toBe(false);
    expect(await canOpen(withCode(user))).toBe(true);
    expect(await canOpen(friend)).toBe(true); // the other member has no app: unaffected
  });

  it("visitors who aren't signed in are untouched", async () => {
    expect((await asUser(null, "select count(*)::int as n from public.cities"))[0].n).toBeGreaterThan(0);
  });

  it("every table with row security carries the rule, tables added by later migrations too", async () => {
    // A new table needs: create policy second_factor on public.<table> as restrictive for all to authenticated
    //   using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()));
    const missing = await admin<{ table: string }>(
      `select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
          and not exists (select 1 from pg_policies p
                           where p.schemaname = 'public' and p.tablename = c.relname
                             and p.policyname = 'second_factor' and p.permissive = 'RESTRICTIVE')`,
    );
    expect(missing).toEqual([]);
  });
});

describe("admins can reset someone's two-step verification (lost phone)", () => {
  it("only admins see who uses it, and only admins can reset it, never their own", async () => {
    const boss = await createUser("Boss", { admin: true });
    const user = await createUser("LostPhone");
    const other = await createUser("Other");
    await addFactor(user);

    const seen = await rpcRows<{ admin_users_with_second_factor: string }>(boss, "admin_users_with_second_factor", {
      p_user_ids: [user, other],
    });
    expect(seen.map((r) => r.admin_users_with_second_factor)).toEqual([user]);
    expect(await errorOf(rpcRows(other, "admin_users_with_second_factor", { p_user_ids: [user] }))).toMatch(/forbidden/);

    expect(await errorOf(rpc(other, "admin_reset_second_factor", { p_user_id: user }))).toMatch(/forbidden/);
    expect(await errorOf(rpc(null, "admin_reset_second_factor", { p_user_id: user }))).toMatch(/permission denied/);
    expect(await errorOf(rpc(boss, "admin_reset_second_factor", { p_user_id: boss }))).toMatch(/cannot_moderate_self/);
    expect(await errorOf(rpc(boss, "admin_reset_second_factor", { p_user_id: randomUUID() }))).toMatch(/user_not_found/);

    await rpc(boss, "admin_reset_second_factor", { p_user_id: user, p_reason: "lost phone" });
    const audit = await admin<{ actor_id: string; details: { reason: string } }>(
      "select actor_id, details from public.audit_logs where action = 'second_factor_reset' and entity_id = $1",
      [user],
    );
    expect(audit).toEqual([{ actor_id: boss, details: { reason: "lost phone" } }]);
  });

  it("an admin who uses an app needs the code for admin work too", async () => {
    const boss = await createUser("Boss", { admin: true });
    const user = await createUser("User");
    await addFactor(boss);
    expect(await errorOf(rpc(password(boss), "admin_reset_second_factor", { p_user_id: user }))).toMatch(/mfa_required/);
    await expect(rpc(withCode(boss), "admin_reset_second_factor", { p_user_id: user })).resolves.not.toThrow();
  });
});
