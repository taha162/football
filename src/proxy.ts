import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

/**
 * 1. Resolves the locale (prefix redirect / cookie) via next-intl.
 * 2. Refreshes the Supabase session cookie on the same response.
 * Authorization is NOT done here: every page and action checks the user
 * server-side, and the database enforces RLS.
 */
export async function proxy(request: NextRequest) {
  const response = intl(request);
  // Redirect responses don't need a session refresh.
  if (response.headers.get("location")) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  // Validates and, if needed, refreshes the session.
  const { data } = await supabase.auth.getUser();

  // Optimistic redirect for signed-out visitors to private areas (proper 307
  // instead of an in-stream redirect). Pages and the database still enforce
  // authorization independently.
  if (!data.user) {
    const [, locale, ...rest] = request.nextUrl.pathname.split("/");
    const path = `/${rest.join("/")}`;
    if (PROTECTED.some((p) => path === p || path.startsWith(`${p}/`)) && routing.locales.includes(locale as "ar")) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/sign-in`;
      url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
      const redirect = NextResponse.redirect(url);
      for (const c of response.cookies.getAll()) redirect.cookies.set(c);
      return redirect;
    }
  }
  return response;
}

const PROTECTED = ["/dashboard", "/my", "/manage", "/messages", "/notifications", "/settings", "/profile", "/onboarding", "/admin"];

export const config = {
  // Skip API routes, auth callbacks, Next internals and static files.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
