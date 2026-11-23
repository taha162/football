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

});
