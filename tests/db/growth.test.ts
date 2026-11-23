import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc } from "./helpers";

/** Migrations 0037–0039: indexes behind foreign keys, old rows cleared away, the admin overview kept 5 minutes. */
describe("ready for growth", () => {
  it("every foreign key has an index (currencies aside: they are never deleted)", async () => {
    const missing = await admin<{ tbl: string; cols: string }>(`
      with fk as (
        select c.conrelid, c.conkey, c.confrelid, c.conrelid::regclass::text as tbl,
               (select string_agg(a.attname, ',') from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) as cols
          from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace)
      select tbl, cols from fk
       where confrelid <> 'public.currencies'::regclass
         and not exists (select 1 from pg_index i where i.indrelid = fk.conrelid
                          and (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] @> fk.conkey
                          and (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] <@ fk.conkey)`);
    expect(missing).toEqual([]);
  });

  it("clears notifications and audit entries past their keeping periods, and nothing newer", async () => {
    const who = await createUser("Retention");
    const rows = await admin<{ id: string; tag: string }>(
      `insert into public.notifications (user_id, type, payload, created_at, read_at) values
         ($1, 'match_joined', '{"t":"read-old"}', now() - interval '200 days', now() - interval '199 days'),
         ($1, 'match_joined', '{"t":"unread-old"}', now() - interval '400 days', null),
         ($1, 'match_joined', '{"t":"unread-200"}', now() - interval '200 days', null),
         ($1, 'match_joined', '{"t":"read-new"}', now() - interval '10 days', now() - interval '9 days')
       returning id, payload->>'t' as tag`,
      [who],
    );
    await admin(
      `insert into public.audit_logs (actor_id, action, entity_type, created_at) values
         ($1, 'retention.old', 'test', now() - interval '800 days'), ($1, 'retention.new', 'test', now() - interval '10 days')`,
      [who],
    );
    const result = await admin<{ r: { notifications: number; audit_logs: number } }>("select public.run_retention_cleanup() as r");
    expect(result[0].r.notifications).toBeGreaterThanOrEqual(2);
    const left = await admin<{ tag: string }>("select payload->>'t' as tag from public.notifications where id = any($1::uuid[]) order by 1", [rows.map((r) => r.id)]);
    expect(left.map((r) => r.tag)).toEqual(["read-new", "unread-200"]);
    const audit = await admin<{ action: string }>("select action from public.audit_logs where actor_id = $1 order by 1", [who]);
    expect(audit.map((a) => a.action)).toEqual(["retention.new"]);
  });

  it("lets only the scheduled job run the cleanup", async () => {
    const someone = await createUser("Retention caller");
    expect(await errorOf(asUser(someone, "select public.run_retention_cleanup()"))).toMatch(/permission denied/);
  });

  it("keeps the admin overview's numbers for 5 minutes, then works them out again", async () => {
    const moderator = await createUser("Stats admin", { admin: true });
    const first = await rpc<{ users: number; computed_at: string }>(moderator, "admin_stats");
    expect(first.users).toBeGreaterThan(0);
    const again = await rpc<{ computed_at: string }>(moderator, "admin_stats");
    expect(again.computed_at).toBe(first.computed_at);
    await admin("update private.admin_stats_cache set computed_at = now() - interval '6 minutes'");
    const fresh = await rpc<{ users: number; computed_at: string }>(moderator, "admin_stats");
    expect(Date.parse(fresh.computed_at)).toBeGreaterThan(Date.parse(first.computed_at));
    const player = await createUser("Stats player");
    expect(await errorOf(rpc(player, "admin_stats"))).toBe("forbidden");
  });
});
