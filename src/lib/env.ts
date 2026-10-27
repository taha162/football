/**
 * Environment access. Public values are inlined by Next.js at build time;
 * server-only secrets must never be imported from client components
 * (see `src/lib/supabase/admin.ts`, which is guarded by `server-only`).
 */

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  mapProvider: (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "none") as "none" | "mapbox",
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

/** True when storage is served from a local/private host (local development). */
export function isLocalStorageHost(): boolean {
  if (!publicEnv.supabaseUrl) return false;
  const host = new URL(publicEnv.supabaseUrl).hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
}
