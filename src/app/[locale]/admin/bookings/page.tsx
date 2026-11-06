import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

/**
 * Every venue's bookings, newest first. Admins and moderators handle them
 * with the venue staff's powers from each venue's own bookings page.
 */
export default async function AdminBookingsPage() {
  const t = await getTranslations("admin");
  const b = await getTranslations("bookings");
  const locale = await getLocale();
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, status, kind, starts_at, price_total, currency, created_at, venue:venues(id, name, city:cities(timezone)), requester:profiles!bookings_requested_by_fkey(id, display_name)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  return (
    <>
      <PageHeader title={t("nav.bookings")} description={t("bookingsDescription")} />
      {/* relative: the screen-reader label in the last heading is positioned absolutely; without it the label
          escapes the scrolling frame and widens the whole page on a phone. */}
      <div className="relative overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-2 text-start">{t("venue")}</th>
              <th className="p-2 text-start">{t("customer")}</th>
              <th className="p-2 text-start">{t("when")}</th>
              <th className="p-2 text-start">{t("status")}</th>
              <th className="p-2 text-end">{t("value")}</th>
              <th className="p-2"><span className="sr-only">{t("handle")}</span></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => {
              const tz = r.venue?.city?.timezone ?? "Asia/Baghdad";
              const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(r.starts_at));
              return (
                <tr key={r.id} className="border-t border-line">
                  <td className="p-2">{r.venue ? <Link href={`/venues/${r.venue.id}`} className="hover:underline">{r.venue.name}</Link> : "—"}</td>
                  <td className="p-2">{r.requester ? <Link href={`/players/${r.requester.id}`} className="hover:underline">{r.requester.display_name}</Link> : b(`kind.${r.kind}`)}</td>
                  <td className="p-2 text-muted">{formatDateTime(r.starts_at, locale, tz)}</td>
                  <td className="p-2"><Badge>{b(`status.${r.status}`)}</Badge></td>
                  <td className="num p-2 text-end">{formatMoney(r.price_total, r.currency, locale)}</td>
                  <td className="p-2 text-end">
                    {r.venue ? (
                      <LinkButton href={{ pathname: `/manage/venues/${r.venue.id}`, query: { tab: "bookings", date: day } }} className={buttonClass("outline", "sm")}>
                        {t("handle")}
                      </LinkButton>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
