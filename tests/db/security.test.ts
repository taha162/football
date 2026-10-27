import { describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, errorOf, mosul, rpc } from "./helpers";

describe("direct table access is denied (frontend bypass)", () => {
  it("anon and authenticated roles cannot write tables directly", async () => {
    const user = await createUser();
    const city = await mosul();
    expect(
      await errorOf(
        asUser(
          user,
          `insert into public.matches (organizer_id, title, city_id, starts_at, ends_at, format, total_players, currency)
           values ($1, 'x', $2, now() + interval '1 day', now() + interval '25 hours', '5v5', 10, 'IQD')`,
          [user, city],
        ),
      ),
    ).toMatch(/permission denied/);
    expect(await errorOf(asUser(null, "delete from public.cities"))).toMatch(/permission denied/);
    expect(await errorOf(asUser(user, "update public.profiles set status = 'active' where id = $1", [user]))).toMatch(
      /permission denied/,
    );
    expect(await errorOf(asUser(user, "insert into public.notifications (user_id, type) values ($1, 'match_joined')", [user]))).toMatch(
      /permission denied/,
    );
  });

  it("users cannot manipulate match capacity counters or participants directly", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    expect(await errorOf(asUser(organizer, "update public.matches set confirmed_count = 0 where id = $1", [match]))).toMatch(
      /permission denied/,
    );
    expect(
      await errorOf(
        asUser(organizer, "insert into public.match_participants (match_id, user_id, status) values ($1, $2, 'confirmed')", [
          match,
          organizer,
        ]),
      ),
    ).toMatch(/permission denied/);
  });

  it("internal helpers in the private schema cannot be called through the API roles", async () => {
    const user = await createUser();
    expect(await errorOf(asUser(user, "select private.notify($1, 'x', '{}')", [user]))).toMatch(/permission denied/);
    expect(await errorOf(asUser(user, "select private.audit('x', 'y', 'z')"))).toMatch(/permission denied/);
    expect(await errorOf(asUser(user, "select public.run_scheduled_jobs()"))).toMatch(/permission denied/);
  });

  it("anon cannot call mutating RPCs", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    expect(await errorOf(rpc(null, "join_match", { p_match_id: match }))).toMatch(/permission denied/);
  });
});

describe("privilege escalation", () => {
  it("users cannot make themselves administrators", async () => {
    const user = await createUser();
    expect(await errorOf(asUser(user, "insert into public.user_roles (user_id, role) values ($1, 'admin')", [user]))).toMatch(
      /permission denied/,
    );
    expect(await errorOf(rpc(user, "admin_set_role", { p_user_id: user, p_role: "admin", p_grant: true }))).toBe("forbidden");
    expect(await errorOf(rpc(user, "admin_stats"))).toBe("forbidden");
    expect(await errorOf(rpc(user, "admin_update_setting", { p_key: "messaging.max_per_minute", p_value: "1000" }))).toBe("forbidden");
  });

  it("moderators cannot grant roles or suspend admins; admins cannot drop their own admin role", async () => {
    const adminUser = await createUser("Admin", { admin: true });
    const moderator = await createUser("Mod");
    await rpc(adminUser, "admin_set_role", { p_user_id: moderator, p_role: "moderator", p_grant: true });
    expect(await errorOf(rpc(moderator, "admin_set_role", { p_user_id: moderator, p_role: "admin", p_grant: true }))).toBe("forbidden");
    expect(
      await errorOf(rpc(moderator, "admin_set_user_status", { p_user_id: adminUser, p_status: "suspended", p_reason: "nope" })),
    ).toBe("forbidden");
    expect(await errorOf(rpc(adminUser, "admin_set_role", { p_user_id: adminUser, p_role: "admin", p_grant: false }))).toBe(
      "cannot_revoke_own_admin",
    );
  });

  it("records administrative actions in the audit log, visible only to admins", async () => {
    const adminUser = await createUser("Admin", { admin: true });
    const target = await createUser();
    await rpc(adminUser, "admin_set_user_status", { p_user_id: target, p_status: "suspended", p_reason: "spam bot" });
    const logs = await asUser<{ action: string }>(adminUser, "select action from public.audit_logs where entity_id = $1", [target]);
    expect(logs.map((l) => l.action)).toContain("user.suspended");
    expect(await asUser(target, "select * from public.audit_logs where entity_id = $1", [target])).toEqual([]);
    // Suspended users are blocked by every mutating RPC.
    expect(await errorOf(rpc(target, "create_team", { p_name: "Ghosts", p_city_id: await mosul() }))).toBe("account_suspended");
  });
});

describe("private data isolation", () => {
  it("users only see their own notifications, preferences and bookings", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await admin("insert into public.notifications (user_id, type) values ($1, 'account_notice')", [a]);
    expect(await asUser(b, "select * from public.notifications where user_id = $1", [a])).toEqual([]);
    expect(await asUser(b, "select * from public.user_preferences where user_id = $1", [a])).toEqual([]);
    expect(await asUser(a, "select * from public.user_preferences where user_id = $1", [a])).toHaveLength(1);
    expect(await asUser(null, "select * from public.user_preferences")).toEqual([]);
    // mark_notifications_read cannot touch someone else's notifications
    expect(await rpc(b, "mark_notifications_read")).toBe(0);
  });

  it("guests can browse public listings but not rosters", async () => {
    const organizer = await createUser("Org");
    const player = await createUser();
    const match = await createMatch(organizer);
    await rpc(player, "join_match", { p_match_id: match });
    expect(await asUser(null, "select id, confirmed_count from public.matches where id = $1", [match])).toEqual([
      { id: match, confirmed_count: 1 },
    ]);
    expect(await asUser(null, "select * from public.match_participants where match_id = $1", [match])).toEqual([]);
    expect(await asUser(await createUser(), "select * from public.match_participants where match_id = $1", [match])).toHaveLength(1);
  });

  it("e-mail addresses are never exposed through profiles", async () => {
    const user = await createUser();
    const [row] = await asUser<Record<string, unknown>>(null, "select * from public.profiles where id = $1", [user]);
    expect(Object.keys(row)).not.toContain("email");
    expect(await errorOf(asUser(user, "select email from auth.users"))).toMatch(/permission denied/);
  });
});
