import { defineRouting } from "next-intl/routing";

// The site is Arabic only. The English texts stay in messages/en.json: adding
// "en" back here (and the switcher in the header) brings English back.
export const locales = ["ar"] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "ar",
  localePrefix: "always",
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
