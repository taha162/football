/**
 * The site's Content-Security-Policy: where the browser may load from.
 *
 * Pages get it from the proxy with a fresh `nonce` on every request
 * (src/proxy.ts): only scripts carrying that nonce run, and scripts they load
 * (`'strict-dynamic'`). Next.js stamps the nonce on its own scripts by reading
 * this header from the request; the layout stamps the two first-paint scripts.
 * An injected `<script>`, or an `onerror=` attribute in injected markup, has
 * no nonce and is blocked. Other responses (API routes, files) get the
 * nonce-less variant from next.config.ts.
 *
 * Styles allow inline ones: React writes `style` attributes, which a nonce
 * can't cover. Data, live updates, pictures and voice notes come from
 * Supabase; map pictures from OpenStreetMap and Mapbox. Nothing may frame the
 * site, and forms post only to it.
 */
export function contentSecurityPolicy(nonce?: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const host = supabaseUrl ? new URL(supabaseUrl) : null;
  const isDev = process.env.NODE_ENV === "development";
  const supabaseOrigin = host?.origin ?? "";
  const supabaseSocket = host ? `${host.protocol === "https:" ? "wss" : "ws"}://${host.host}` : "";
  // React rebuilds error stacks with eval in development only.
  const evalInDev = isDev ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalInDev}` : `script-src 'self' 'unsafe-inline'${evalInDev}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseOrigin} https://tile.openstreetmap.org https://api.mapbox.com`,
    `media-src 'self' blob: ${supabaseOrigin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only where everything is served over https (not the local development stack).
    ...(host?.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ]
    .map((d) => d.replace(/\s+/g, " ").trim())
    .join("; ");
}

/** A fresh, unguessable nonce for one response (base64 of 128 random bits). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
