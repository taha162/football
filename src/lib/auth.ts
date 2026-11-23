import "server-only";
import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { isSupabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/log";
import { PROFILE_COLUMNS, type Profile } from "@/lib/profile-columns";
import { hasSecondFactor } from "@/lib/second-factor";
import { createClient } from "@/lib/supabase/server";

export type { Profile };

export interface CurrentUser {
  id: string;
  email: string | null;
  /** The confirmed number (E.164 digits), for accounts verified with one. */
  phone: string | null;
  profile: Profile;
  roles: ("admin" | "moderator")[];
  isAdmin: boolean;
  isModerator: boolean;
}

/**
 * The signed-in user for this request, plus their profile and roles.
 * Memoized per request.
 *
 * The session is verified with getClaims(): its signature is checked against
 * the project's published keys, on this server, when the project signs
 * sessions with asymmetric keys (Supabase → Authentication → JWT Keys), and by
 * the Auth server otherwise (the same call getUser() makes). Every page
 * request has already been checked with the Auth server moments before, by
 * the proxy (src/proxy.ts), which also ends sessions that are too old; this
 * second check no longer costs a second call to it. The database checks the
 * same signed token on every query (RLS).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const id = claims.sub;
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", id),
  ]);
  if (!profile) return null;
  const roleList = (roles ?? []).map((r) => r.role);
  return {
    id,
    email: typeof claims.email === "string" && claims.email ? claims.email : null,
    phone: typeof claims.phone === "string" && claims.phone ? claims.phone : null,
    profile,
    roles: roleList,
    isAdmin: roleList.includes("admin"),
    isModerator: roleList.includes("admin") || roleList.includes("moderator"),
  };
});

/**
 * What only the Auth server knows about the account (not in the session's
 * token): whether the e-mail is confirmed, and whether an authenticator app is
 * set up. Asked only by the pages that show it (settings, administration).
 */
export const getAccountStatus = cache(async (): Promise<{ emailConfirmed: boolean; secondFactor: boolean }> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { emailConfirmed: Boolean(data.user?.email_confirmed_at), secondFactor: hasSecondFactor(data.user) };
});

/** Redirects to sign-in (returning here afterwards) when signed out. */
export async function requireUser(locale: Locale, returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect({ href: { pathname: "/sign-in", query: { next: returnTo } }, locale });
  }
  return user!;
}

/** As requireUser, and also requires completed onboarding. */
export async function requireOnboardedUser(locale: Locale, returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(locale, returnTo);
  if (!user.profile.onboarded_at) {
    redirect({ href: { pathname: "/onboarding", query: { next: returnTo } }, locale });
  }
  return user;
}

export async function requireModerator(locale: Locale): Promise<CurrentUser> {
  const user = await requireUser(locale, "/admin");
  if (!user.isModerator) {
    // A member without a staff role tried the admin area: sent away, and noted (Vercel → Logs).
    logger.warn("admin_access_denied", { user: user.id });
    redirect({ href: "/dashboard", locale });
  }
  return user;
}

export { safeNext } from "./safe-next";
