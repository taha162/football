import { BadgeCheck, MapPinned } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/domain/money";
import { acceptsPlatformBookings } from "@/lib/domain/venue";
import { publicStorageUrl } from "@/lib/storage";
import { localizedName } from "@/server/reference";
import type { VenueCardData } from "@/server/venues/queries";
import { StorageImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/primitives";
import { CardCover } from "@/components/ui/card-cover";

export async function VenueCard({ venue, role }: { venue: VenueCardData; role?: string }) {
  const t = await getTranslations("venues");
  const locale = await getLocale();
  const active = venue.fields.filter((f) => f.is_active);
  const minPrice = active.length ? Math.min(...active.map((f) => f.price_per_hour)) : null;
  const cover = publicStorageUrl("venue-images", venue.cover_image_path);
  const placeholder = (
    <div className="pitch-lines flex size-full items-center justify-center text-faint">
      <MapPinned aria-hidden="true" className="size-8" />
    </div>
  );
  return (
    <article className="reveal card-hover spotlight relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface hover:border-line-strong">
      <div className="relative aspect-[16/9] bg-surface-3">
        {cover ? <StorageImage src={cover} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" className="object-cover" fallback={placeholder} /> : placeholder}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-semibold">
          <Link href={`/venues/${venue.id}`} className="focus-visible:outline-none">{venue.name}</Link>
          {venue.verification_status === "verified" ? <BadgeCheck aria-label={t("verified")} className="size-4 text-accent" /> : null}
        </h3>
        <p className="text-xs text-muted">{[localizedName(venue.area, locale), localizedName(venue.city, locale)].filter(Boolean).join("، ")}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {acceptsPlatformBookings(venue) ? <Badge tone="accent">{t("bookable")}</Badge> : <Badge>{t("contactOnly")}</Badge>}
          <Badge>{t("fieldCount", { count: active.length })}</Badge>
          {role ? <Badge tone="info">{t(`role.${role}`)}</Badge> : null}
        </div>
        {minPrice != null ? <p className="num text-sm">{t("fromPrice", { price: formatMoney(minPrice, "IQD", locale) })}</p> : null}
      </div>
      <CardCover href={`/venues/${venue.id}`} />
    </article>
  );
}
