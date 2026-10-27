/**
 * Integration-test harness for the database.
 *
 * Users are impersonated exactly like PostgREST does it: the session switches
 * to the `authenticated` (or `anon`) role and sets `request.jwt.claims`, so
 * RLS policies, privileges and SECURITY DEFINER RPCs behave as in production.
 * Fixture setup that has no public API equivalent (e.g. moving a match into
 * the past) uses the superuser connection and is marked as such.
 */
import { randomUUID } from "node:crypto";
import { Client, Pool, type QueryResultRow } from "pg";
import { afterAll } from "vitest";

export const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const openClients = new Set<Client>();

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  openClients.add(client);
  return client;
}

afterAll(async () => {
  await Promise.all([...openClients].map((c) => c.end().catch(() => undefined)));
  openClients.clear();
});

let superPool: Pool | null = null;

afterAll(async () => {
  await superPool?.end();
  superPool = null;
});

/** Superuser query, for fixture setup only. */
export async function admin<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  superPool ??= new Pool({ connectionString: DB_URL, max: 5 });
  const res = await superPool.query<T>(sql, params);
  return res.rows;
}

export type Actor = string | null; // user id, or null for anon

/** Runs SQL as the given user (or anon) inside its own transaction. */
export async function asUser<T extends QueryResultRow = QueryResultRow>(actor: Actor, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${actor ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(actor ? { sub: actor, role: "authenticated" } : { role: "anon" }),
    ]);
    const res = await c.query<T>(sql, params);
    await c.query("commit");
    return res.rows;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    openClients.delete(c);
    await c.end();
  }
}

/** Calls a public RPC with named arguments as the given actor. */
export async function rpc<T = unknown>(actor: Actor, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const keys = Object.keys(args);
  const params = keys.map((k) => normalize(args[k]));
  const argSql = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const rows = await asUser<{ result: T }>(actor, `select public.${fn}(${argSql}) as result`, params);
  return rows[0]?.result as T;
}

/** Calls a set-returning RPC. */
export async function rpcRows<T extends QueryResultRow = QueryResultRow>(actor: Actor, fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const keys = Object.keys(args);
  const params = keys.map((k) => normalize(args[k]));
  const argSql = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  return asUser<T>(actor, `select * from public.${fn}(${argSql})`, params);
}

/** Objects and arrays of objects are sent as JSON; primitive arrays as Postgres arrays. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.some((v) => v !== null && typeof v === "object") ? JSON.stringify(value) : value;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

/** Awaits a promise expected to fail and returns the database error message. */
export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the operation to fail, but it succeeded");
}

let mosulId: string | null = null;
export async function mosul(): Promise<string> {
  if (!mosulId) {
    const rows = await admin<{ id: string }>("select id from public.cities where slug = 'mosul'");
    mosulId = rows[0].id;
  }
  return mosulId;
}

export async function areaId(slug = "al-zuhur"): Promise<string> {
  const rows = await admin<{ id: string }>("select id from public.areas where slug = $1", [slug]);
  return rows[0].id;
}

/**
 * Creates an auth user (fires the profile trigger) and, by default,
 * completes onboarding through the public RPC as that user.
 */
export async function createUser(name = "Player", opts: { onboard?: boolean; admin?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  const email = `t-${id.slice(0, 8)}@test.local`;
  await admin(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), $3, '{"provider":"email","providers":["email"]}', now(), now())`,
    [id, email, JSON.stringify({ display_name: `${name} ${id.slice(0, 4)}` })],
  );
  if (opts.onboard !== false) {
    await rpc(id, "update_my_profile", {
      p_display_name: `${name} ${id.slice(0, 4)}`,
      p_city_id: await mosul(),
      p_positions: "{midfielder}",
      p_skill_level: "intermediate",
      p_complete_onboarding: true,
    });
  }
  if (opts.admin) {
    // Bootstrap: the first admin is granted out-of-band (see README).
    await admin("insert into public.user_roles (user_id, role) values ($1, 'admin')", [id]);
  }
  return id;
}

export async function createUsers(n: number, name = "Player"): Promise<string[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => createUser(`${name}${i}`)));
}

/** Local wall-clock timestamp in Asia/Baghdad, `days` from now at `hh:mm`. */
export function localTime(days: number, hh = 20, mm = 0): string {
  const now = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export interface MatchOpts {
  total?: number;
  reserved?: number;
  joinPolicy?: "open" | "approval" | "invite_only";
  type?: "open" | "private" | "team_needs_players";
  organizerPlays?: boolean;
  publish?: boolean;
  days?: number;
  extra?: Record<string, unknown>;
}

export async function createMatch(organizer: string, opts: MatchOpts = {}): Promise<string> {
  return rpc<string>(organizer, "create_match", {
    p_title: `Test match ${randomUUID().slice(0, 6)}`,
    p_city_id: await mosul(),
    p_start_local: localTime(opts.days ?? 2),
    p_duration_minutes: 90,
    p_format: "5v5",
    p_total_players: opts.total ?? 10,
    p_reserved_spots: opts.reserved ?? 0,
    p_join_policy: opts.joinPolicy ?? "open",
    p_match_type: opts.type ?? "open",
    p_organizer_plays: opts.organizerPlays ?? false,
    p_publish: opts.publish ?? true,
    ...opts.extra,
  });
}

export async function getMatch(id: string) {
  const rows = await admin<{ status: string; confirmed_count: number; waitlist_count: number; pending_count: number }>(
    "select status, confirmed_count, waitlist_count, pending_count from public.matches where id = $1",
    [id],
  );
  return rows[0];
}

/** Superuser fixture helper: shift a match into the past (no public API can do this). */
export async function moveMatchToPast(matchId: string, hoursAgo = 4) {
  await admin(
    `update public.matches set starts_at = now() - make_interval(hours => $2), ends_at = now() - make_interval(hours => $2) + interval '90 minutes' where id = $1`,
    [matchId, hoursAgo],
  );
}

export async function notificationsOf(userId: string, type?: string) {
  return admin<{ type: string; payload: Record<string, unknown> }>(
    `select type, payload from public.notifications where user_id = $1 and ($2::text is null or type = $2) order by created_at`,
    [userId, type ?? null],
  );
}
