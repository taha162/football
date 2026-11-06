import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// On Vercel, fail the build early and clearly instead of deploying an app that
// cannot reach its database. Server-only secrets are checked at runtime by the
// routes that need them (/api/cron answers 503 without the service role key).
if (process.env.VERCEL) {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables for this Vercel environment: ${missing.join(", ")}. See DEPLOYMENT.md.`);
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL!.startsWith("http://")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an https URL on Vercel (not the local development stack).");
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const storageHost = supabaseUrl ? new URL(supabaseUrl) : null;

const isDev = process.env.NODE_ENV === "development";
const supabaseOrigin = storageHost?.origin ?? "";
const supabaseSocket = storageHost ? `${storageHost.protocol === "https:" ? "wss" : "ws"}://${storageHost.host}` : "";

/**
 * Where the browser may load from. Scripts and styles stay on the site
 * (inline ones too: the page's first-paint scripts and React's style
 * attributes); data, live updates, pictures and voice notes come from
 * Supabase; map pictures from OpenStreetMap and Mapbox. Nothing may frame
 * the site, and forms post only to it. Without nonces, so pages can stay
 * static (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
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
  ...(storageHost?.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
]
  .map((d) => d.replace(/\s+/g, " ").trim())
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The microphone: voice notes and voice calls in conversations. Location: sharing it in a conversation.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Cache Components is intentionally not enabled: almost every page depends
  // on the signed-in user, so the classic dynamic rendering model is simpler
  // and avoids caching private data. See ARCHITECTURE.md.
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: {
      // Image uploads (validated to <= 5 MB server-side).
      bodySizeLimit: "6mb",
    },
    // Turbopack's on-disk cache (on by default since Next 16.3) has served a
    // stale globals.css from earlier runs, both in production builds and
    // after restarting `next dev`: new styles were missing from the output.
    // Vercel restores `.next/cache` between deployments, so a deployment
    // could ship old styles. Every run compiles from the source instead.
    turbopackFileSystemCacheForBuild: false,
    turbopackFileSystemCacheForDev: false,
  },
  images: {
    // Uploaded files get a new random name each time (src/lib/storage.ts), so an
    // address always shows the same picture: optimized copies can be kept a month
    // (Next's default is 4 hours) without ever showing an outdated one.
    minimumCacheTTL: 2_678_400,
    remotePatterns: storageHost
      ? [
          {
            protocol: storageHost.protocol.replace(":", "") as "http" | "https",
            hostname: storageHost.hostname,
            port: storageHost.port,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The site is Arabic only: old English links open the same page in Arabic.
  // Temporary (307), so English can come back without browsers holding on to it.
  async redirects() {
    return [
      { source: "/en", destination: "/ar", permanent: false },
      { source: "/en/:path*", destination: "/ar/:path*", permanent: false },
    ];
  },
};

export default withNextIntl(nextConfig);
