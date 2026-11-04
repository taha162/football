import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

/**
 * Search engines may read the public pages; personal, admin and sign-in-only
 * pages (the same ones src/proxy.ts sends visitors away from) are left out.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/auth/",
        "/ar/admin",
        "/ar/manage",
        "/ar/my",
        "/ar/dashboard",
        "/ar/messages",
        "/ar/notifications",
        "/ar/settings",
        "/ar/profile",
        "/ar/onboarding",
        "/ar/opponents",
        "/ar/matches/new",
        "/ar/teams/new",
        "/ar/tournaments/new",
        "/ar/verify-email",
        "/ar/verify-telegram",
        "/ar/reset-password",
        "/ar/venues/*/book",
        "/ar/venues/*/review",
        "/ar/matches/*/edit",
        "/ar/matches/*/review",
        "/ar/teams/*/manage",
        "/ar/tournaments/*/manage",
      ],
    },
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
  };
}
