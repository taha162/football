import { getTranslations } from "next-intl/server";

export async function Logo() {
  const t = await getTranslations("common");
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="logo-mark size-8">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--color-accent)" />
        <path d="M16 6v20M6 16h20" stroke="var(--color-accent-ink)" strokeWidth="1.6" opacity=".35" />
        <circle cx="16" cy="16" r="5.5" fill="none" stroke="var(--color-accent-ink)" strokeWidth="2.2" />
        <circle cx="16" cy="16" r="1.6" fill="var(--color-accent-ink)" />
      </svg>
      <span className="font-display text-xl font-extrabold tracking-tight">{t("appName")}</span>
    </span>
  );
}
