import { publicEnv } from "@/lib/env";

/**
 * Map provider abstraction. Only providers with configured credentials are
 * used; otherwise callers fall back to list-based discovery. No geocoding is
 * performed — coordinates come only from venue owners or verified data.
 */
export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface MapProvider {
  id: string;
  staticMapUrl(points: MapPoint[], size: { width: number; height: number }): string | null;
  directionsUrl(point: MapPoint): string;
}

const mapbox: MapProvider = {
  id: "mapbox",
  staticMapUrl(points, { width, height }) {
    const valid = points.filter(isValidPoint).slice(0, 50);
    if (valid.length === 0 || !publicEnv.mapboxToken) return null;
    const pins = valid.map((p) => `pin-s+b8f23f(${p.lng.toFixed(5)},${p.lat.toFixed(5)})`).join(",");
    const view = valid.length === 1 ? `${valid[0].lng.toFixed(5)},${valid[0].lat.toFixed(5)},14` : "auto";
    return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pins}/${view}/${width}x${height}@2x?access_token=${encodeURIComponent(publicEnv.mapboxToken)}`;
  },
  directionsUrl: (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
};

/** Without a provider we can still link out for directions; we never render a fake map. */
const none: MapProvider = {
  id: "none",
  staticMapUrl: () => null,
  directionsUrl: (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
};

export function getMapProvider(): MapProvider {
  if (publicEnv.mapProvider === "mapbox" && publicEnv.mapboxToken) return mapbox;
  return none;
}

export function isValidPoint(p: Partial<MapPoint> | null | undefined): p is MapPoint {
  return (
    !!p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}
