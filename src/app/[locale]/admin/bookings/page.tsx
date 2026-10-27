import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/domain/money";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageHeader } from "@/components/ui/primitives";

export default async function AdminBookingsPage() {
  const t = await getTranslations("admin");
  const b = await getTranslations("bookings");
  const locale = await getLocale();
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, status, kind, starts_at, price_total, currency, created_at, venue:venues(id, name), requester:profiles!bookings_requested_by_fkey(id, display_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <>
      <PageHeader title={t("nav.bookings")} description={t("bookingsDescription")} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-2 text-start">{t("venue")}</th>
              <th className="p-2 text-start">{t("customer")}</th>
              <th className="p-2 text-start">{t("when")}</th>
              <th className="p-2 text-start">{t("status")}</th>
              <th className="p-2 text-end">{t("value")}</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="p-2">{r.venue ? <Link href={`/venues/${r.venue.id}`} className="hover:underline">{r.venue.name}</Link> : "—"}</td>
                <td className="p-2">{r.requester ? <Link href={`/players/${r.requester.id}`} className="hover:underline">{r.requester.display_name}</Link> : b(`kind.${r.kind}`)}</td>
                <td className="p-2 text-muted">{formatDateTime(r.starts_at, locale, "Asia/Baghdad")}</td>
                <td className="p-2"><Badge>{b(`status.${r.status}`)}</Badge></td>
                <td className="num p-2 text-end">{formatMoney(r.price_total, r.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
