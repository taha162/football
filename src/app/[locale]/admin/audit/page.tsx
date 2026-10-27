import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";

export default async function AdminAuditPage({ searchParams }: PageProps<"/[locale]/admin/audit">) {
  const locale = await getLocale();
  if (!(await getCurrentUser())?.isAdmin) redirect({ href: "/admin", locale });
  const t = await getTranslations("admin");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_actor_id_fkey(display_name)")
    .order("created_at", { ascending: false })
    .range((page - 1) * 50, page * 50);
  const rows = (data ?? []).slice(0, 50);
  return (
    <>
      <PageHeader title={t("nav.audit")} description={t("auditDescription")} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-2 text-start">{t("when")}</th>
              <th className="p-2 text-start">{t("actor")}</th>
              <th className="p-2 text-start">{t("action")}</th>
              <th className="p-2 text-start">{t("entity")}</th>
              <th className="p-2 text-start">{t("details")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-2 text-muted">{formatDateTime(r.created_at, locale, "Asia/Baghdad")}</td>
                <td className="p-2">{r.actor?.display_name ?? t("system")}</td>
                <td className="p-2 font-mono text-xs" dir="ltr">{r.action}</td>
                <td className="p-2 font-mono text-xs" dir="ltr">{r.entity_type}:{r.entity_id?.slice(0, 8)}</td>
                <td className="p-2 font-mono text-xs text-muted" dir="ltr">{JSON.stringify(r.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pathname="/admin/audit" query={{}} page={page} hasMore={(data ?? []).length > 50} />
    </>
  );
}
