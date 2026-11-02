/**
 * A location shared in a conversation: the point, and how accurate the phone
 * said it was (metres). Helpers to read one from a form, link it to a maps
 * app, and draw it on map tiles.
 */
export interface SharedPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
}

const filled = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Reads a point from form values: null when none was sent, "invalid" when malformed. */
export function readPoint(lat: unknown, lng: unknown, accuracy: unknown): SharedPoint | null | "invalid" {
  if (!filled(lat) && !filled(lng)) return null;
  const la = Number(lat);
  const lo = Number(lng);
  if (!filled(lat) || !filled(lng) || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return "invalid";
  if (!filled(accuracy)) return { lat: la, lng: lo, accuracy: null };
  const acc = Number(accuracy);
  if (!Number.isFinite(acc) || acc < 0 || acc > 100_000) return "invalid";
  return { lat: la, lng: lo, accuracy: acc };
}

/** Opens the point in the phone's maps app (Google Maps' cross-platform link). */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export const TILE = 256;

/** Web Mercator: where the point falls, in tiles, at zoom z. */
export function tilePosition(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/** Ground metres covered by one map pixel at this latitude and zoom. */
export function metresPerPixel(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** The tiles that cover a width × height view centred on the point, with where each sits in the view. */
export function tilesAround(lat: number, lng: number, z: number, width: number, height: number) {
  const { x, y } = tilePosition(lat, lng, z);
  const n = 2 ** z;
  const left = x * TILE - width / 2;
  const top = y * TILE - height / 2;
  const tiles: { x: number; y: number; left: number; top: number }[] = [];
  for (let tx = Math.floor(left / TILE); tx * TILE < left + width; tx++) {
    for (let ty = Math.floor(top / TILE); ty * TILE < top + height; ty++) {
      if (ty < 0 || ty >= n) continue;
      tiles.push({ x: ((tx % n) + n) % n, y: ty, left: Math.round(tx * TILE - left), top: Math.round(ty * TILE - top) });
    }
  }
  return tiles;
}
