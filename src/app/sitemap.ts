import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/** Rebuilt at most once an hour. */
export const revalidate = 3600;

const SECTIONS = ["", "/matches", "/venues", "/teams", "/tournaments", "/recruitment", "/legal/terms", "/legal/privacy", "/legal/safety"];

/** The database returns at most this many rows per request. */
const PAGE = 1000;

type Row = { id: string; updated_at: string };

/**
 * Every row of a listing, a page at a time, up to `cap`. The order must be
 * total (ends with the id) so pages neither repeat nor skip rows.
 */
async function everyRow(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>, cap: number) {
  const rows: Row[] = [];
  while (rows.length < cap) {
    const { data, error } = await page(rows.length, Math.min(rows.length + PAGE, cap) - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/**
 * What search engines may index: the main sections and what anyone can open
 * without signing in (verified venues, upcoming public matches, public teams
 * and tournaments), read as a guest so the database's own rules apply.
 * One sitemap holds at most 50,000 addresses; the caps keep it under that.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = publicEnv.siteUrl;
  const entries: MetadataRoute.Sitemap = SECTIONS.map((path) => ({
    url: `${site}/ar${path}`,
    changeFrequency: path.startsWith("/legal") ? "yearly" : "hourly",
    priority: path === "" ? 1 : path.startsWith("/legal") ? 0.2 : 0.8,
  }));
  if (!isSupabaseConfigured()) return entries;
  const guest = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const [venues, matches, teams, tournaments] = await Promise.all([
    everyRow(
      (from, to) =>
        guest.from("venues").select("id, updated_at").eq("verification_status", "verified")
          .order("updated_at", { ascending: false }).order("id").range(from, to),
      10_000,
    ),
    everyRow(
      (from, to) =>
        guest.from("matches").select("id, updated_at").in("status", ["open", "full", "confirmed"]).gt("starts_at", now)
          .order("starts_at").order("id").range(from, to),
      30_000,
    ),
    everyRow((from, to) => guest.from("teams").select("id, updated_at").order("updated_at", { ascending: false }).order("id").range(from, to), 6_000),
    everyRow((from, to) => guest.from("tournaments").select("id, updated_at").order("updated_at", { ascending: false }).order("id").range(from, to), 2_000),
  ]);
  const add = (section: string, rows: Row[], priority: number) => {
    for (const r of rows) entries.push({ url: `${site}/ar/${section}/${r.id}`, lastModified: r.updated_at, changeFrequency: "daily", priority });
  };
  add("venues", venues, 0.7);
  add("matches", matches, 0.6);
  add("teams", teams, 0.5);
  add("tournaments", tournaments, 0.5);
  return entries;
}
