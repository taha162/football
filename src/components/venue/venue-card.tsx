import { BadgeCheck, MapPinned } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/domain/money";
import { acceptsPlatformBookings } from "@/lib/domain/venue";
import { publicStorageUrl } from "@/lib/storage";
import { localizedName } from "@/server/reference";
import { getDepositSettings, type VenueCardData } from "@/server/venues/queries";
import { StorageImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/primitives";
import { CardCover } from "@/components/ui/card-cover";

/**
 * A venue in a list; two sit side by side on a phone, so everything wraps to a
 * narrow card. It opens the venue's page, or `href` (its booking page, when
 * the list is for booking).
 */
export async function VenueCard({ venue, role, href = `/venues/${venue.id}` }: { venue: VenueCardData; role?: string; href?: string }) {
  const t = await getTranslations("venues");
  const locale = await getLocale();
  const active = venue.fields.filter((f) => f.is_active);
  const minPrice = active.length ? Math.min(...active.map((f) => f.price_per_hour)) : null;
  const cover = publicStorageUrl("venue-images", venue.cover_image_path);
  const bookable = acceptsPlatformBookings(venue, (await getDepositSettings()).on);
  const placeholder = (
    <div className="pitch-lines flex size-full items-center justify-center text-faint">
      <MapPinned aria-hidden="true" className="size-8" />
    </div>
  );
  return (
    <article className="reveal card-hover spotlight relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface hover:border-line-strong">
      <div className="relative aspect-[16/9] bg-surface-3">
        {cover ? <StorageImage src={cover} alt="" fill sizes="(min-width: 1024px) 33vw, 50vw" className="object-cover" fallback={placeholder} /> : placeholder}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-4">
        <h3 className="flex items-start gap-1 font-display text-base font-semibold leading-snug sm:items-center sm:gap-1.5 sm:text-lg">
          <Link href={href} className="line-clamp-2 break-words focus-visible:outline-none">{venue.name}</Link>
          {venue.verification_status === "verified" ? <BadgeCheck aria-label={t("verified")} className="mt-1 size-4 shrink-0 text-accent sm:mt-0" /> : null}
        </h3>
        <p className="truncate text-xs text-muted">{[localizedName(venue.area, locale), localizedName(venue.city, locale)].filter(Boolean).join("، ")}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {bookable ? <Badge tone="accent">{t("bookable")}</Badge> : <Badge>{t("notBookableYet")}</Badge>}
          {active.length > 1 ? <Badge>{t("fieldCount", { count: active.length })}</Badge> : null}
          {role ? <Badge tone="info">{t(`role.${role}`)}</Badge> : null}
        </div>
        {minPrice != null ? <p className="num text-xs sm:text-sm">{t("fromPrice", { price: formatMoney(minPrice, "IQD", locale) })}</p> : null}
      </div>
      <CardCover href={href} />
    </article>
  );
}
