"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Languages } from "lucide-react";
import { usePathname } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

/** Switches language on the same page; next-intl persists the choice in a cookie. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const search = useSearchParams();
  const t = useTranslations("common");
  const target = locale === "ar" ? "en" : "ar";
  const query = Object.fromEntries(search.entries());
  return (
    <LinkButton
      href={{ pathname, query }}
      locale={target}
      className={buttonClass("ghost", "sm", "gap-1.5 px-2.5")}
      hrefLang={target}
      lang={target}
      aria-label={t("switchLanguage")}
    >
      <Languages aria-hidden="true" className="size-4" />
      <span className="hidden sm:inline">{target === "ar" ? "العربية" : "English"}</span>
    </LinkButton>
  );
}
