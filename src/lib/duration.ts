/** A length of time as m:ss (or h:mm:ss), in the page's digits: «٣:١٢». */
export function formatDuration(totalSeconds: number, locale: string): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const tag = locale === "ar" ? "ar-IQ" : "en-GB";
  const two = new Intl.NumberFormat(tag, { minimumIntegerDigits: 2, useGrouping: false });
  const one = new Intl.NumberFormat(tag, { useGrouping: false });
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${one.format(h)}:${two.format(m)}:${two.format(sec)}` : `${one.format(m)}:${two.format(sec)}`;
}

/** A distance in metres, rounded for people: «١٢ م», «١٫٢ كم». Units come from the caller's messages. */
export function formatDistance(metres: number, locale: string, units: { m: (n: string) => string; km: (n: string) => string }): string {
  const tag = locale === "ar" ? "ar-IQ" : "en-GB";
  if (metres < 1000) return units.m(new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(metres))));
  return units.km(new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(metres / 1000));
}
