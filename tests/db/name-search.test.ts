import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { DB_URL, admin, createMatch, createUser, rpcRows } from "./helpers";

/** Migration 0036: name search through trigram indexes, with the same results. */
describe("name search through trigram indexes", () => {
  it("finds a match by its title or by its venue's name, and nothing else", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const organizer = await createUser("Search org");
    const byTitle = await createMatch(organizer, { extra: { p_title: `ليلة الجمعة ${tag}` } });
    const atVenue = await createMatch(organizer, { extra: { p_title: `Plain ${tag}x` } });
    const [venue] = await admin<{ id: string }>(
      "insert into public.venues (name, city_id, created_by, verification_status) select $1, city_id, $2, 'verified' from public.matches where id = $3 returning id",
      [`ملعب الشهداء ${tag}`, organizer, atVenue],
    );
    await admin("update public.matches set venue_id = $1 where id = $2", [venue.id, atVenue]);
    const other = await createMatch(organizer, { extra: { p_title: `Other ${tag}y` } });

    const ids = async (q: string) => (await rpcRows<{ id: string }>(null, "search_matches", { p_query: q, p_limit: 50 })).map((r) => r.id);
    expect(await ids(`الجمعة ${tag}`)).toEqual([byTitle]);
    expect(await ids(`الشهداء ${tag}`)).toEqual([atVenue]);
    expect(await ids(tag)).toEqual(expect.arrayContaining([byTitle, atVenue, other]));
    // Wildcards typed by the person are plain characters.
    expect(await ids(`%${tag}_`)).toEqual([]);
  });

  it("serves «contains» searches from the trigram indexes, Arabic included", async () => {
    // On a small table (a fresh test database) Postgres rightly reads it whole.
    // With whole-table reads and plain index walks ruled out, the plan shows
    // whether an index can answer «contains» at all: a plain b-tree cannot.
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    let plan = "";
    try {
      await c.query("begin");
      await c.query("set local enable_seqscan = off; set local enable_indexscan = off; set local enable_indexonlyscan = off");
      const { rows } = await c.query("explain (costs off) select id from public.profiles where display_name ilike '%حمد الطائي%'");
      plan = rows.map((r) => Object.values(r)[0]).join("\n");
    } finally {
      await c.query("rollback").catch(() => undefined);
      await c.end();
    }
    expect(plan).toMatch(/Bitmap Index Scan on profiles_display_name_trgm/);
    const indexes = await admin<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and indexname in ('profiles_display_name_trgm', 'teams_name_trgm', 'venues_name_trgm', 'matches_title_trgm', 'profiles_display_name_idx', 'teams_name_idx', 'venues_name_idx') order by 1",
    );
    expect(indexes.map((i) => i.indexname)).toEqual(["matches_title_trgm", "profiles_display_name_trgm", "teams_name_trgm", "venues_name_trgm"]);
  });
});
