import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { contentSecurityPolicy, newNonce } from "./lib/csp";
import { sessionCookieOptions } from "./lib/env";
import { hasSecondFactor, needsSecondStep } from "./lib/second-factor";

const intl = createMiddleware(routing);

/**
 * 1. Resolves the locale (prefix redirect / cookie) via next-intl.
 * 2. Refreshes the Supabase session cookie on the same response.
 * Authorization is NOT done here: every page and action checks the user
 * server-side, and the database enforces RLS.
 */
export async function proxy(request: NextRequest) {
  // The site is Arabic only (old /en links are redirected in next.config.ts).
  // next-intl doesn't see Accept-Language, so nothing tries another language.
  const headers = new Headers(request.headers);
  headers.delete("accept-language");
  // A fresh nonce for this page: Next.js reads it from the request's policy
  // and stamps its scripts; the layout reads x-nonce for its own two.
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const response = intl(new NextRequest(request, { headers }));
  // Redirect responses don't need a session refresh.
  if (response.headers.get("location")) return response;
  response.headers.set("Content-Security-Policy", csp);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookieOptions: sessionCookieOptions(),
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
  const [, locale, ...rest] = request.nextUrl.pathname.split("/");
  const path = `/${rest.join("/")}`;
  if (!routing.locales.includes(locale as "ar")) return response;

  /** A 307 to `/{locale}{to}?next=<this page>`, keeping any refreshed session cookies. */
  const sendTo = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${to}`;
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  };

  // Optimistic redirect for signed-out visitors to private areas (proper 307
  // instead of an in-stream redirect). Pages and the database still enforce
  // authorization independently.
  if (!data.user) return PROTECTED.some((p) => p.test(path)) ? sendTo("/sign-in") : response;

  // Password passed, authenticator-app code not yet: the database shows such a
  // session nothing (migration 0027), so every page but the code page waits for it.
  if (hasSecondFactor(data.user)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (needsSecondStep(data.user, aal?.currentLevel, path)) return sendTo("/mfa");
  }
  return response;
}

/** Pages that need a signed-in person (each also checks for itself); visitors are sent to sign in before anything renders. */
const PROTECTED = [
  /^\/(dashboard|my|manage|messages|notifications|settings|profile|onboarding|admin|opponents)(\/|$)/,
  /^\/(matches|teams|tournaments)\/new\/?$/,
  /^\/matches\/[^/]+\/(edit|review)\/?$/,
  /^\/(teams|tournaments)\/[^/]+\/manage\/?$/,
  /^\/venues\/[^/]+\/(book|review)\/?$/,
];

export const config = {
  // Skip API routes, auth callbacks, Next internals and static files.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
