import { getLocale, getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { formatClock, weekdayIn } from "@/lib/format";

/** Days from Saturday, as the week runs in Iraq (0 = Sunday). */
export const WEEK = [6, 0, 1, 2, 3, 4, 5] as const;

export const dayName = (d: number, locale: string) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + d)));

/**
 * A venue's opening hours as a plain table: each day with the time it opens
 * and the time it closes, or «مغلق». Today's row is marked. A closing time at
 * or before the opening time is on the next day (e.g. 4 pm to 2 am).
 */
export async function OpeningHours({ hours, timeZone }: { hours: { weekday: number; opens: string; closes: string }[]; timeZone?: string }) {
  const t = await getTranslations("venues");
  const locale = await getLocale();
  if (hours.length === 0) return <p className="text-sm text-muted">{t("hoursUnknown")}</p>;
  const today = timeZone ? weekdayIn(timeZone) : -1;
  return (
    <table className="w-full text-sm" data-testid="opening-hours">
      <caption className="sr-only">{t("openingHours")}</caption>
      <thead>
        <tr className="text-xs text-muted">
          <th scope="col" className="pb-2 text-start font-medium">{t("hoursDay")}</th>
          <th scope="col" className="pb-2 text-start font-medium">{t("hoursOpens")}</th>
          <th scope="col" className="pb-2 text-start font-medium">{t("hoursCloses")}</th>
        </tr>
      </thead>
      <tbody>
        {WEEK.map((d) => {
          const h = hours.find((x) => x.weekday === d);
          const allDay = h && h.opens.slice(0, 5) === h.closes.slice(0, 5);
          const midnight = h?.closes.slice(0, 5) === "00:00";
          const nextDay = h && !allDay && !midnight && h.closes <= h.opens;
          return (
            <tr key={d} className={cn("border-t border-line", d === today && "bg-accent/5")}>
              <th scope="row" className="py-2 pe-2 text-start font-normal">
                {dayName(d, locale)}
                {d === today ? <span className="ms-1.5 text-xs font-semibold text-accent">{t("today")}</span> : null}
              </th>
              {!h ? (
                <td colSpan={2} className="py-2 text-faint">{t("closed")}</td>
              ) : allDay ? (
                <td colSpan={2} className="py-2">{t("allDay")}</td>
              ) : (
                <>
                  <td className="num py-2 pe-2">{formatClock(h.opens, locale)}</td>
                  <td className="num py-2">
                    {midnight ? t("midnight") : formatClock(h.closes, locale)}
                    {nextDay ? <span className="block text-[11px] text-faint">{t("nextDay")}</span> : null}
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
