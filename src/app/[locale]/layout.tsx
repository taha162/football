import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Barlow, Barlow_Condensed, Cairo } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { directionOf, routing } from "@/i18n/routing";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MobileNav } from "@/components/layout/mobile-nav";
import { getCurrentUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { INTRO_SCRIPT } from "@/components/stage/intro-script";
import { MotionRoot } from "@/components/motion/motion-root";
import { PageTransition } from "@/components/motion/page-transition";
import "../globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap" });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-barlow-condensed",
  display: "swap",
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
    alternates: { languages: { ar: "/ar", en: "/en" } },
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
        <NextIntlClientProvider>
          <a
            href="#main"
            className="sr-only z-50 rounded-lg bg-accent font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:px-4 focus:py-2"
          >
            {t("skipToContent")}
          </a>
          <SiteHeader user={user} />
          <main id="main" className="flex-1 pb-24 md:pb-12">
            <PageTransition>{children}</PageTransition>
          </main>
          <SiteFooter />
          <MobileNav signedIn={Boolean(user)} />
          {/* After the page content, so its effects run once the router has placed the new page. */}
          <MotionRoot />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
