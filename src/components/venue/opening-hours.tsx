import { getLocale, getTranslations } from "next-intl/server";

/** Opening hours table; closing at/before opening means the window ends next day. */
export async function OpeningHours({ hours }: { hours: { weekday: number; opens: string; closes: string }[] }) {
  const t = await getTranslations("venues");
  const locale = await getLocale();
  const dayName = (d: number) => new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + d)));
  if (hours.length === 0) return <p className="text-sm text-muted">{t("hoursUnknown")}</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t("openingHours")}</caption>
      <tbody>
        {[6, 0, 1, 2, 3, 4, 5].map((d) => {
          const h = hours.find((x) => x.weekday === d);
          return (
            <tr key={d} className="border-b border-line last:border-0">
              <th scope="row" className="py-1.5 text-start font-normal text-muted">{dayName(d)}</th>
              <td className="num py-1.5 text-end" dir="ltr">
                {h ? `${h.opens.slice(0, 5)} – ${h.closes.slice(0, 5)}${h.closes <= h.opens ? " (+1)" : ""}` : <span className="text-faint">{t("closed")}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
