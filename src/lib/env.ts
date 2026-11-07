/**
 * Environment access. Public values are inlined by Next.js at build time;
 * server-only secrets must never be imported from client components
 * (see `src/lib/supabase/admin.ts`, which is guarded by `server-only`).
 */

/**
 * The origin (scheme + host) of a site address as someone typed it. Copying
 * the address from the browser brings the language path along
 * ("https://al-malab.vercel.app/ar"), which must not end up in webhook or
 * e-mail links, so any path, query or fragment is dropped. Null if unusable.
 */
export function siteOrigin(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return url.hostname ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Absolute site origin. An explicit NEXT_PUBLIC_SITE_URL wins (set it for the
 * production environment, e.g. a custom domain). On Vercel it otherwise falls
 * back to the system variables, so preview deployments send auth e-mail links
 * to their own URL.
 */
function resolveSiteUrl(): string {
  const explicit = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  if (explicit) return explicit;
  const host =
    process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
      ? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
      : process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

export const publicEnv = {
  // Without a trailing slash, so storage URLs never get a double slash (which
  // the image optimizer's path pattern rejects).
  supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, ""),
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: resolveSiteUrl(),
  mapProvider: (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "none") as "none" | "mapbox",
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "",
};

/**
 * Options for the Supabase session cookie. @supabase/ssr leaves out `Secure`,
 * so a browser would also send the session over plain http (an http link, a
 * hostile network before HSTS is known). Wherever the site is served over
 * https, the cookie is marked Secure. It stays readable by the page's own
 * script, which the browser client needs for live updates; the nonce policy
 * (src/lib/csp.ts) keeps other script from running.
 */
export function sessionCookieOptions(siteUrl = publicEnv.siteUrl): { secure: boolean } {
  return { secure: siteUrl.startsWith("https://") };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

/** True when storage is served from a local/private host (local development). */
export function isLocalStorageHost(): boolean {
  if (!publicEnv.supabaseUrl) return false;
  const host = new URL(publicEnv.supabaseUrl).hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
}
