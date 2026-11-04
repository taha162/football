"use client";

import { NextIntlClientProvider } from "next-intl";
import type { Locale } from "@/i18n/routing";
import ar from "../../../messages/ar.json";

/** Adding a language to the site means adding its messages here too (the type insists). */
const MESSAGES: Record<Locale, typeof ar> = { ar };

/**
 * Gives browser components the site's text, with the same locale and time
 * zone the server uses (src/i18n/request.ts).
 *
 * The text travels in the JavaScript, which a phone downloads once and keeps.
 * next-intl's server provider would instead write all of it into every page
 * and into every live refresh (router.refresh): about half of each, ~33 KB on
 * the wire, again and again on mobile data.
 */
export function IntlProvider({ locale, timeZone, children }: { locale: Locale; timeZone: string; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={MESSAGES[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}
