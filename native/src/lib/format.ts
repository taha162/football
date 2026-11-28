/**
 * Times as the site shows them: Baghdad time (UTC+3 all year: Iraq keeps no
 * summer time), in Arabic, without relying on the phone's date settings.
 */
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const OFFSET_MS = 3 * 60 * 60 * 1000;

const baghdad = (iso: string) => new Date(Date.parse(iso) + OFFSET_MS);

export function formatTime(iso: string): string {
  const d = baghdad(iso);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "ص" : "م"}`;
}

export function formatDay(iso: string, now = Date.now()): string {
  const d = baghdad(iso);
  const today = baghdad(new Date(now).toISOString());
  const days = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000);
  if (days === 0) return "اليوم";
  if (days === 1) return "غداً";
  if (days === -1) return "أمس";
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export const formatDateTime = (iso: string) => `${formatDay(iso)}، ${formatTime(iso)}`;

/** The list of conversations: the time today, else the day. */
export const formatListTime = (iso: string) => (formatDay(iso) === "اليوم" ? formatTime(iso) : formatDay(iso));

export function formatPrice(amount: number, currency = "IQD"): string {
  if (!amount) return "مجاناً";
  const n = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return currency === "IQD" ? `${n} د.ع` : `${n} ${currency}`;
}

const SHORT_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** A match ticket's date stub: the weekday (or اليوم/غداً), the day, the month, the time. */
export function dateParts(iso: string): { weekday: string; day: string; month: string; time: string } {
  const d = baghdad(iso);
  const label = formatDay(iso);
  return {
    weekday: label === "اليوم" || label === "غداً" ? label : SHORT_DAYS[d.getUTCDay()],
    day: String(d.getUTCDate()),
    month: MONTHS[d.getUTCMonth()],
    time: formatTime(iso),
  };
}
