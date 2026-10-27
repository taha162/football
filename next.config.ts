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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const storageHost = supabaseUrl ? new URL(supabaseUrl) : null;

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
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
  },
  images: {
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
};

export default withNextIntl(nextConfig);
