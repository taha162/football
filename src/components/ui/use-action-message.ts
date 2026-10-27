"use client";

import { useTranslations } from "next-intl";

/** Translates success message codes returned by server actions (messages.success.<code>). */
export function useActionMessage() {
  const t = useTranslations("success");
  return (code: string) => (t.has(code) ? t(code) : t("saved"));
}
