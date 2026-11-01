import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { BRAND, MARK_PLAYER, WORDMARK } from "./brand";

/** The tile: the centre circle cut through by the halfway band, and a bicycle kick inside. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 729 720" aria-hidden="true" className={className}>
      <rect width="729" height="720" rx="152" fill={BRAND.lime} />
      <rect x="9" y="9" width="711" height="702" rx="143" fill="none" stroke={BRAND.rim} strokeWidth="18" />
      <rect y="309" width="729" height="113" fill={BRAND.ink} />
      <circle cx="364.5" cy="359.5" r="254.5" fill={BRAND.ink} />
      <path fill={BRAND.lime} fillRule="evenodd" d={MARK_PLAYER} />
    </svg>
  );
}

/** The «الملعب» lettering, in the current text colour. */
export function Wordmark({ label, className }: { label: string; className?: string }) {
  return (
    <svg viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} role="img" aria-label={label} className={cn("fill-current", className)}>
      <path fillRule="evenodd" d={WORDMARK.d} />
    </svg>
  );
}

export async function Logo() {
  const [t, locale] = await Promise.all([getTranslations("common"), getLocale()]);
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className="logo-mark size-8 shrink-0 sm:size-[34px]" />
      {locale === "ar" ? (
        <Wordmark label={t("appName")} className="h-5 w-auto shrink-0 sm:h-6" />
      ) : (
        <span className="font-display text-xl font-extrabold tracking-tight">{t("appName")}</span>
      )}
    </span>
  );
}
