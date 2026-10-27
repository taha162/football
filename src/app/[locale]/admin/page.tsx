import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button";
import { Alert, PageHeader, Section, Stat } from "@/components/ui/primitives";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stats");
  const s = (data ?? {}) as Record<string, number>;
  const keys = [
    "users", "users_new_7d", "users_suspended", "matches_upcoming", "matches_completed_30d", "matches_cancelled_30d",
    "participations_30d", "teams", "venues", "venues_pending_verification", "bookings_pending", "bookings_confirmed_30d",
    "tournaments_active", "reports_open",
  ];
  return (
    <>
      <PageHeader title={t("overview")} />
      {error ? <Alert tone="danger">{t("loadError")}</Alert> : null}
      <Section>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {keys.map((k) => <Stat key={k} label={t(`stats.${k}`)} value={s[k] ?? 0} />)}
        </dl>
      </Section>
      <div className="flex flex-wrap gap-2">
        {(s.reports_open ?? 0) > 0 ? <Link href="/admin/reports" className={buttonClass("primary", "md")}>{t("reviewReports")}</Link> : null}
        {(s.venues_pending_verification ?? 0) > 0 ? <Link href="/admin/venues" className={buttonClass("secondary", "md")}>{t("reviewVenues")}</Link> : null}
      </div>
    </>
  );
}
