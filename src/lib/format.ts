/**
 * Date/time helpers. Timestamps are stored as UTC (timestamptz) and always
 * displayed in the relevant city's timezone, never the server's.
 */

const intlLocale = (locale: string) => (locale === "ar" ? "ar-IQ" : "en-GB");

export function formatDateTime(iso: string | Date, locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  }).format(new Date(iso));
}

export function formatDate(iso: string | Date, locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, day: "numeric", month: "short", year: "numeric", ...opts }).format(
    new Date(iso),
  );
}

export function formatTime(iso: string | Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatNumber(n: number, locale: string) {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}

/** "YYYY-MM-DDTHH:mm" wall-clock value of an instant in a timezone (for datetime-local inputs). */
export function toLocalInputValue(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(timeZone: string, offsetDays = 0): string {
  return toLocalInputValue(new Date(Date.now() + offsetDays * 86_400_000), timeZone).slice(0, 10);
}

/** Converts a datetime-local value to the "YYYY-MM-DD HH:mm" form RPCs expect. */
export function toRpcLocal(value: string): string {
  return value.replace("T", " ");
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
}
