import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { BRAND, MARK_PLAYER, TILE, WORDMARK } from "./brand";

/** The tile: the centre circle cut through by the halfway band, and a bicycle kick inside. */
export function BrandMark({ className }: { className?: string }) {
  const half = TILE.rim / 2;
  return (
    <svg viewBox={`0 0 ${TILE.width} ${TILE.height}`} aria-hidden="true" className={className}>
      <rect width={TILE.width} height={TILE.height} rx={TILE.radius} fill={BRAND.lime} />
      <rect x={half} y={half} width={TILE.width - TILE.rim} height={TILE.height - TILE.rim} rx={TILE.radius - half} fill="none" stroke={BRAND.rim} strokeWidth={TILE.rim} />
      <rect y={TILE.band.y} width={TILE.width} height={TILE.band.height} fill={BRAND.ink} />
      <circle cx={TILE.circle.cx} cy={TILE.circle.cy} r={TILE.circle.r} fill={BRAND.ink} />
      <path fill={BRAND.lime} fillRule="evenodd" d={MARK_PLAYER} />
    </svg>
  );
}

/** The «الملعب» lettering, in the current text colour. */
export function Wordmark({ label, className }: { label: string; className?: string }) {
  return (
    <svg viewBox={WORDMARK.viewBox} role="img" aria-label={label} className={cn("fill-current", className)}>
      <path d={WORDMARK.d} />
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
