"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { LocateFixed } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/**
 * Requests browser location only when the user asks for nearby matches.
 * Coordinates are rounded (~1 km) before being placed in the URL and are
 * never stored.
 */
export function NearMe() {
  const t = useTranslations("discovery");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [status, setStatus] = useState<"idle" | "pending" | "denied" | "unsupported">("idle");
  const active = params.has("lat");

  const clear = () => {
    const q = new URLSearchParams(params);
    ["lat", "lng", "radius"].forEach((k) => q.delete(k));
    if (q.get("sort") === "distance") q.delete("sort");
    router.push(`${pathname}?${q.toString()}`);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) return setStatus("unsupported");
    setStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const q = new URLSearchParams(params);
        q.set("lat", pos.coords.latitude.toFixed(2));
        q.set("lng", pos.coords.longitude.toFixed(2));
        if (!q.get("radius")) q.set("radius", "10");
        q.set("sort", "distance");
        q.delete("page");
        setStatus("idle");
        router.push(`${pathname}?${q.toString()}`);
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      {active ? (
        <Button variant="outline" size="sm" onClick={clear}>
          {t("clearNearMe")}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={locate} disabled={status === "pending"}>
          <LocateFixed aria-hidden="true" className="size-4" />
          {t("nearMe")}
        </Button>
      )}
      <p className="text-xs text-muted" aria-live="polite">
        {status === "denied" ? t("locationDenied") : status === "unsupported" ? t("locationUnsupported") : active ? null : t("nearMeHint")}
      </p>
    </div>
  );
}
