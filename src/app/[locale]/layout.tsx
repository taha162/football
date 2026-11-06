import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Barlow, Barlow_Condensed, Cairo } from "next/font/google";
import { hasLocale } from "next-intl";
import { getTimeZone, getTranslations, setRequestLocale } from "next-intl/server";
import { directionOf, routing } from "@/i18n/routing";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { LandingOnly } from "@/components/layout/landing-only";
import { CallProvider } from "@/components/calls/call-provider";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { MobileNav } from "@/components/layout/mobile-nav";
import { IntlProvider } from "@/components/layout/intl-provider";
import { getCurrentUser } from "@/lib/auth";
import { getLiveCheckSeconds } from "@/server/reference";
import { publicEnv } from "@/lib/env";
import { INTRO_SCRIPT } from "@/components/stage/intro-script";
import { ENTER_SCRIPT } from "@/components/motion/enter-script";
import { MotionRoot } from "@/components/motion/motion-root";
import { PageTransition } from "@/components/motion/page-transition";
import { Container } from "@/components/ui/primitives";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import "../globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });
// Arabic pages are set in Cairo only. The Latin faces aren't preloaded, so a
// first visit on mobile data doesn't fetch ~100 KB of fonts it never shows:
// Barlow serves English pages, and the landing stadium loads the condensed
// face for its boards itself (stage-host.tsx).
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap", preload: false });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-barlow-condensed",
  display: "swap",
  preload: false,
});

export const viewport: Viewport = {
  themeColor: "#0a0e0b",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(publicEnv.siteUrl),
    title: { default: t("title"), template: `%s · ${t("appName")}` },
    description: t("description"),
    // The share image (opengraph-image.png beside the root layout) shows the full logo.
    openGraph: { type: "website", siteName: t("appName"), title: t("title"), description: t("description"), locale: "ar_IQ" },
    twitter: { card: "summary_large_image", title: t("title"), description: t("description") },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const user = await getCurrentUser();
  const t = await getTranslations({ locale, namespace: "common" });
  const fontVars =
    locale === "ar"
      ? { "--font-body": "var(--font-cairo)", "--font-heading": "var(--font-cairo)" }
      : { "--font-body": "var(--font-barlow)", "--font-heading": "var(--font-barlow-condensed)" };

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${cairo.variable} ${barlow.variable} ${barlowCondensed.variable} antialiased`}
      style={fontVars as React.CSSProperties}
      // The pre-paint script below sets data-intro on <html> before hydration (landing page).
      suppressHydrationWarning
    >
      <body className="flex min-h-svh flex-col">
        {/* Landing page only: decides before first paint whether the opening plays. */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
        {/* Every page: content rises into place at first paint (components/motion/enter-script.ts). */}
        <script dangerouslySetInnerHTML={{ __html: ENTER_SCRIPT }} />
        <IntlProvider locale={locale} timeZone={await getTimeZone()}>
          <a
            href="#main"
            className="sr-only z-50 rounded-lg bg-accent font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:px-4 focus:py-2"
          >
            {t("skipToContent")}
          </a>
          {/* Voice calls ring on every page, and carry on while the person moves around the site. */}
          <CallProvider me={user?.profile.onboarded_at ? user.id : null}>
            <SiteHeader user={user} />
            <main id="main" className="flex-1 pb-24 lg:pb-12">
              {/* A first visit streams: the header goes out at once, the page as soon as its data is in.
                  The skeleton stands in only if that takes over a second (.page-fallback in globals.css).
                  Moving between pages keeps the current page up instead (components/motion/nav-progress.tsx):
                  unlike a loading.tsx, this boundary is not shown on navigation. */}
              <Suspense
                fallback={
                  <Container className="page-fallback py-10" aria-busy="true">
                    <p role="status" className="sr-only">
                      {t("loading")}
                    </p>
                    <PageSkeleton />
                  </Container>
                }
              >
                <PageTransition>{children}</PageTransition>
              </Suspense>
            </main>
            <LandingOnly>
              <SiteFooter />
            </LandingOnly>
            <MobileNav signedIn={Boolean(user)} />
          </CallProvider>
          {/* Pages stay up to date without reloading: news arrives live, and open pages check every so often (live.check_seconds). */}
          {user ? <LiveRefresh userId={user.id} checkSeconds={await getLiveCheckSeconds()} /> : null}
          {/* After the page content, so its effects run once the router has placed the new page. */}
          <MotionRoot />
        </IntlProvider>
      </body>
    </html>
  );
}
