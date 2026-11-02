"use client";

import { ExternalLink, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatDistance } from "@/lib/duration";
import { mapsUrl } from "@/lib/geo";
import { LocationMap } from "./location-map";

/** A location in the conversation: a small map; tapping it opens the phone's maps app at that point. */
export function LocationCard({ lat, lng, accuracy }: { lat: number; lng: number; accuracy: number | null }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  return (
    <a
      href={mapsUrl(lat, lng)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="location-card"
      className="group block w-64 max-w-full overflow-hidden rounded-2xl border border-line bg-surface-2 transition-colors hover:border-line-strong"
    >
      <LocationMap lat={lat} lng={lng} accuracy={accuracy} />
      <span className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <MapPin aria-hidden="true" className="size-4 shrink-0 text-accent" />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-ink">{t("location")}</span>
            {accuracy !== null ? (
              <span className="text-[11px] text-muted">{t("locationAccuracy", { distance: formatDistance(accuracy, locale, { m: (n) => t("metres", { n }), km: (n) => t("kilometres", { n }) }) })}</span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">
          {t("openInMaps")}
          <ExternalLink aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
        </span>
      </span>
    </a>
  );
}
