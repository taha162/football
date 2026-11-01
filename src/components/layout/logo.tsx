import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { BRAND, LOCKUP, MARK_PLAYER, SLOGAN, TILE, WORDMARK } from "./brand";

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

/** The logo's line «احنا الاسسنا الملعب واحنا النلعب بي», in the logo's lime and lettering. */
function SloganLine({ label, className }: { label: string; className?: string }) {
  return (
    <svg viewBox={SLOGAN.viewBox} role="img" aria-label={label} lang="ar" className={className}>
      <path fill={BRAND.lime} fillOpacity={SLOGAN.opacity} d={SLOGAN.d} />
    </svg>
  );
}

/** «الملعب» with its line under it, sized and placed exactly as on the logo. */
function Lockup({ label, className }: { label: string; className?: string }) {
  return (
    <svg viewBox={LOCKUP.viewBox} role="img" aria-label={label} className={className}>
      <path className="fill-current" d={WORDMARK.d} />
      <path fill={BRAND.lime} fillOpacity={SLOGAN.opacity} d={SLOGAN.d} />
    </svg>
  );
}

/**
 * The tile and the name. With `slogan` (the header), the name carries the
 * logo's line under it, so the tile grows to the height of the two lines.
 */
export async function Logo({ slogan = false }: { slogan?: boolean }) {
  const [t, locale] = await Promise.all([getTranslations("common"), getLocale()]);
  if (slogan) {
    const line = t("slogan");
    return (
      <span className="flex items-center gap-2.5 sm:gap-3">
        <BrandMark className="logo-mark size-[38px] shrink-0 sm:size-11" />
        {locale === "ar" ? (
          <Lockup label={`${t("appName")} — ${line}`} className="h-[38px] w-auto shrink-0 sm:h-11" />
        ) : (
          <span className="flex shrink-0 flex-col items-start gap-1">
            <span className="font-display text-[22px] font-extrabold leading-none tracking-tight sm:text-[26px]">{t("appName")}</span>
            <SloganLine label={line} className="h-[11px] w-auto sm:h-3" />
          </span>
        )}
      </span>
    );
  }
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
