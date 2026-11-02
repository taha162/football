"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { metresPerPixel, tilesAround } from "@/lib/geo";

const ZOOM = 16; // street level: about 500 m across a phone-width map

/**
 * A small map centred on a shared point: OpenStreetMap tiles, a pin, and a
 * ring for how accurate the phone said the point was. Decorative (the caption
 * beside it says what it is); without the tiles it still shows the pin on a
 * plain grid. Fills its container's width.
 */
export function LocationMap({ lat, lng, accuracy, height = 144, className }: { lat: number; lng: number; accuracy?: number | null; height?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(256);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(120, Math.round(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tiles = tilesAround(lat, lng, ZOOM, width, height);
  const radius = accuracy ? accuracy / metresPerPixel(lat, ZOOM) : 0;
  return (
    <div ref={box} aria-hidden="true" className={cn("location-map relative w-full overflow-hidden", className)} style={{ height }}>
      {tiles.map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element -- map tiles, positioned by hand
        <img
          key={`${tile.x}/${tile.y}`}
          src={`https://tile.openstreetmap.org/${ZOOM}/${tile.x}/${tile.y}.png`}
          alt=""
          width={256}
          height={256}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
          className="location-tile absolute max-w-none select-none"
          style={{ left: tile.left, top: tile.top }}
        />
      ))}
      {radius >= 8 && radius < Math.max(width, height) ? (
        <span
          className="absolute rounded-full border border-accent/70 bg-accent/15"
          style={{ width: radius * 2, height: radius * 2, left: width / 2 - radius, top: height / 2 - radius }}
        />
      ) : null}
      {/* The pin's tip sits on the point. */}
      <svg viewBox="0 0 24 32" className="absolute h-9 w-7 drop-shadow-[0_2px_3px_rgb(0_0_0/0.5)]" style={{ left: width / 2 - 14, top: height / 2 - 36 }}>
        <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0Z" fill="var(--color-accent)" />
        <circle cx="12" cy="11.5" r="4.5" fill="var(--color-accent-ink)" />
      </svg>
      <span className="absolute bottom-0.5 end-1 rounded bg-bg/75 px-1 text-[9px] leading-4 text-muted" dir="ltr">
        © OpenStreetMap
      </span>
    </div>
  );
}
