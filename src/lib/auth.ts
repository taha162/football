import "server-only";
import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";

export type Profile = Tables<"profiles">;

export interface CurrentUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  profile: Profile;
  roles: ("admin" | "moderator")[];
  isAdmin: boolean;
  isModerator: boolean;
}

/**
 * The signed-in user for this request, validated with the Auth server
 * (getUser), plus their profile and roles. Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", data.user.id),
  ]);
  if (!profile) return null;
  const roleList = (roles ?? []).map((r) => r.role);
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailConfirmed: Boolean(data.user.email_confirmed_at),
    profile,
    roles: roleList,
    isAdmin: roleList.includes("admin"),
    isModerator: roleList.includes("admin") || roleList.includes("moderator"),
  };
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
  if (!user.isModerator) redirect({ href: "/dashboard", locale });
  return user;
}

/** Only allows same-site relative paths as post-auth redirect targets. */
export function safeNext(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
