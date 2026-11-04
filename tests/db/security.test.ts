import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, DB_URL, errorOf, mosul, rpc } from "./helpers";

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

describe("launch audit: the database's own guards", () => {
  it("every table has row-level security, the API roles write nothing directly, and elevated functions pin their search path", async () => {
    const withoutRls = await admin<{ relname: string }>(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity",
    );
    expect(withoutRls).toEqual([]);
    const writable = await admin<{ table_name: string }>(
      "select distinct table_name from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema = 'public' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')",
    );
    expect(writable).toEqual([]);
    const unpinned = await admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','private') and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(unpinned).toEqual([]);
  });

  it("guests can call only read-only functions; anything new must be added here on purpose", async () => {
    const open = await admin<{ proname: string }>(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') order by 1",
    );
    expect(open.map((r) => r.proname)).toEqual([
      "field_busy_intervals",
      "free_start_times",
      "match_transition_allowed",
      "player_reputation",
      "player_stats",
      "quote_booking",
      "search_matches",
      "tournament_transition_allowed",
      "venue_rating",
    ]);
  });
});

describe("sign-in and sign-up limits (auth_throttle)", () => {
  const asService = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
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
  };
  const throttle = async (buckets: object[], record: boolean) =>
    (await asService<{ ok: boolean }>("select public.auth_throttle($1::jsonb, $2) as ok", [JSON.stringify(buckets), record]))[0].ok;

  it("only the site's server may count attempts", async () => {
    const bucket = [{ key: `test:${randomUUID()}`, setting: "auth.none", default: 3, window: 60 }];
    expect(await errorOf(asUser(null, "select public.auth_throttle($1::jsonb, true)", [JSON.stringify(bucket)]))).toMatch(/permission denied/);
    expect(await errorOf(asUser(await createUser(), "select public.auth_throttle($1::jsonb, true)", [JSON.stringify(bucket)]))).toMatch(/permission denied/);
  });

  it("allows up to the limit, then refuses; checking alone counts nothing; keys are separate", async () => {
    const account = { key: `test:${randomUUID()}`, setting: "auth.none", default: 3, window: 60 };
    const device = { key: `test:${randomUUID()}`, setting: "auth.none", default: 5, window: 60 };
    for (let i = 0; i < 5; i++) expect(await throttle([account, device], false)).toBe(true);
    expect(await throttle([account, device], true)).toBe(true);
    expect(await throttle([account, device], true)).toBe(true);
    expect(await throttle([account, device], true)).toBe(true);
    // The account's three are used up, whatever the device says.
    expect(await throttle([account, device], true)).toBe(false);
    expect(await throttle([account], false)).toBe(false);
    // A refusal counts nothing: the device is still at three of five.
    const [{ n }] = await admin<{ n: string }>("select count(*) as n from private.auth_attempts where key = $1", [device.key]);
    expect(Number(n)).toBe(3);
    expect(await throttle([{ ...account, key: `test:${randomUUID()}` }, device], true)).toBe(true);
  });

  it("an admin's setting overrides the default limit", async () => {
    const key = `test:${randomUUID()}`;
    await admin("insert into public.platform_settings (key, value, is_public) values ('auth.test_limit', '1', false) on conflict (key) do update set value = '1'");
    try {
      expect(await throttle([{ key, setting: "auth.test_limit", default: 100, window: 60 }], true)).toBe(true);
      expect(await throttle([{ key, setting: "auth.test_limit", default: 100, window: 60 }], true)).toBe(false);
    } finally {
      await admin("delete from public.platform_settings where key = 'auth.test_limit'");
    }
  });
});

describe("public listings' fast check keeps private rows private", () => {
  it("guests see public rows only; owners still see their own private, hidden or draft ones", async () => {
    const owner = await createUser("Owner");
    const city = await mosul();
    const match = await createMatch(owner);
    await admin("update public.matches set visibility = 'private' where id = $1", [match]);
    const team = await rpc<string>(owner, "create_team", { p_name: `Private FC ${owner.slice(0, 4)}`, p_city_id: city });
    await admin("update public.teams set visibility = 'private' where id = $1", [team]);
    const venue = await rpc<string>(owner, "create_venue", { p_name: `Hidden ${owner.slice(0, 4)}`, p_city_id: city });
    await rpc(owner, "upsert_venue_field", {
      p_venue_id: venue, p_field_id: null, p_name: "Field 1", p_surface: "artificial_turf", p_formats: "{5v5}",
      p_is_covered: false, p_has_lights: true, p_price_per_hour: 1000,
    });
    await rpc(owner, "set_venue_opening_hours", { p_venue_id: venue, p_hours: [{ weekday: 1, opens: "16:00", closes: "23:00" }] });
    await admin("update public.venues set is_hidden = true where id = $1", [venue]);
    const [{ id: tournament }] = await admin<{ id: string }>(
      `insert into public.tournaments (organizer_id, name, city_id, format, tournament_format, team_capacity, registration_deadline, starts_on, ends_on, status, currency)
       values ($1, 'Draft cup', $2, '5v5', 'round_robin', 4, now() + interval '20 days', current_date + 30, current_date + 31, 'draft', 'IQD') returning id`,
      [owner, city],
    );

    const sees = async (actor: string | null, sql: string, id: string) => (await asUser(actor, sql, [id])).length;
    for (const actor of [null, await createUser("Stranger")]) {
      expect(await sees(actor, "select id from public.matches where id = $1", match)).toBe(0);
      expect(await sees(actor, "select id from public.teams where id = $1", team)).toBe(0);
      expect(await sees(actor, "select id from public.venues where id = $1", venue)).toBe(0);
      expect(await sees(actor, "select id from public.venue_fields where venue_id = $1", venue)).toBe(0);
      expect(await sees(actor, "select venue_id from public.venue_opening_hours where venue_id = $1", venue)).toBe(0);
      expect(await sees(actor, "select id from public.tournaments where id = $1", tournament)).toBe(0);
    }
    expect(await sees(owner, "select id from public.matches where id = $1", match)).toBe(1);
    expect(await sees(owner, "select id from public.teams where id = $1", team)).toBe(1);
    expect(await sees(owner, "select id from public.venues where id = $1", venue)).toBe(1);
    expect(await sees(owner, "select id from public.venue_fields where venue_id = $1", venue)).toBe(1);
    expect(await sees(owner, "select id from public.tournaments where id = $1", tournament)).toBe(1);
  });
});
