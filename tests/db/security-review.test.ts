import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, DB_URL, errorOf } from "./helpers";

/**
 * Security review of 17 November 2026 (migration 0032): moderation notes hidden
 * from the API, five failures before an account waits, and security events in
 * the audit log with an alert for every admin.
 */

/** Runs SQL as the site's server (the service role), like src/lib/throttle.ts does. */
async function asService<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("set local role service_role");
    const res = await c.query<T>(sql, params);
    await c.query("commit");
    return res.rows;
  } finally {
    await c.end();
  }
}

const event = (action: string, user: string | null, details: object, key: string | null) =>
  asService<{ r: boolean }>("select public.security_event($1, $2, $3::jsonb, $4) as r", [action, user, JSON.stringify(details), key]).then((rows) => rows[0].r);

const alertsOf = (userId: string, key: string) =>
  admin<{ payload: { kind: string; account: string; has_account: boolean } }>(
    "select payload from public.notifications where user_id = $1 and type = 'security_alert' and dedupe_key like $2",
    [userId, `security:%:${key}:%`],
  );

describe("profiles: moderation notes stay with the moderators", () => {
  it("visitors and members read a profile, but not why or when someone was suspended", async () => {
    const member = await createUser("Suspended");
    await admin("update public.profiles set status = 'suspended', suspended_at = now(), suspension_reason = 'private note' where id = $1", [member]);
    for (const actor of [null, await createUser("Viewer")]) {
      const [row] = await asUser<{ display_name: string; status: string }>(actor, "select display_name, status from public.profiles where id = $1", [member]);
      expect(row).toMatchObject({ display_name: expect.stringMatching(/^Suspended/), status: "suspended" });
      expect(await errorOf(asUser(actor, "select suspension_reason from public.profiles where id = $1", [member]))).toMatch(/permission denied/);
      expect(await errorOf(asUser(actor, "select suspended_at from public.profiles where id = $1", [member]))).toMatch(/permission denied/);
      // So `select *` is refused too: the site names its columns (src/lib/profile-columns.ts).
      expect(await errorOf(asUser(actor, "select * from public.profiles where id = $1", [member]))).toMatch(/permission denied/);
    }
  });
});

describe("five failures, then the account waits", () => {
  it("the per-account limits for wrong passwords and wrong codes are 5", async () => {
    const rows = await admin<{ key: string; value: number }>(
      "select key, value::int as value from public.platform_settings where key in ('auth.signin_failures_per_account', 'auth.code_failures_per_account') order by key",
    );
    expect(rows).toEqual([
      { key: "auth.code_failures_per_account", value: 5 },
      { key: "auth.signin_failures_per_account", value: 5 },
    ]);
  });
});

describe("security events (public.security_event)", () => {
  it("only the site's server may record them", async () => {
    for (const actor of [null, await createUser("Nobody")]) {
      expect(await errorOf(asUser(actor, "select public.security_event('password_changed')"))).toMatch(/permission denied/);
    }
  });

  it("a changed password goes to the audit log, without alerting anyone", async () => {
    const member = await createUser("Changer");
    expect(await event("password_changed", member, {}, null)).toBe(true);
    const [row] = await admin<{ actor_id: string; entity_type: string }>(
      "select actor_id, entity_type from public.audit_logs where action = 'password_changed' and entity_id = $1",
      [member],
    );
    expect(row).toEqual({ actor_id: member, entity_type: "security" });
  });

  it("repeated failures alert every admin once an hour per account; the alert can't be muted; moderators aren't alerted", async () => {
    const boss = await createUser("Boss", { admin: true });
    const mod = await createUser("Mod");
    await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [mod]);
    // Muting it in the settings has no effect: it is mandatory.
    await admin(
      "insert into public.user_preferences (user_id, notification_prefs) values ($1, '{\"security_alert\": false}'::jsonb) on conflict (user_id) do update set notification_prefs = excluded.notification_prefs",
      [boss],
    );
    const key = `signinAccount:${randomUUID()}`;
    const details = { account: "o***@gmail.com", limits: ["auth.signin_failures_per_account"] };

    expect(await event("sign_in_blocked", null, details, key)).toBe(true);
    expect(await event("sign_in_blocked", null, details, key)).toBe(false);
    expect(await event("sign_in_blocked", null, details, key)).toBe(false);

    const alerts = await alertsOf(boss, key);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload).toEqual({ kind: "sign_in_blocked", account: "o***@gmail.com", has_account: true });
    expect(await alertsOf(mod, key)).toHaveLength(0);
    const audit = await admin("select 1 from public.audit_logs where action = 'sign_in_blocked' and details ->> 'dedupe' like $1", [`%${key}%`]);
    expect(audit).toHaveLength(1);

    // Another account is another alert; wrong codes are their own kind.
    const other = `codeAccount:${randomUUID()}`;
    expect(await event("code_blocked", null, { account: "" }, other)).toBe(true);
    expect((await alertsOf(boss, other))[0].payload).toEqual({ kind: "code_blocked", account: "", has_account: false });
  });

  it("refuses anything else", async () => {
    expect(await errorOf(event("drop_everything", null, {}, null))).toMatch(/invalid_action/);
    expect(await errorOf(event("sign_in_blocked", null, {}, "short"))).toMatch(/invalid_key/);
    expect(await errorOf(asService("select public.security_event('password_changed', null, '[1]'::jsonb)"))).toMatch(/invalid_details/);
  });
});
