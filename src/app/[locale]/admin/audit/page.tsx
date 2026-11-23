import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/ui/primitives";

const SIZE = 50;

export default async function AdminAuditPage({ searchParams }: PageProps<"/[locale]/admin/audit">) {
  const locale = await getLocale();
  if (!(await getCurrentUser())?.isAdmin) redirect({ href: "/admin", locale });
  const t = await getTranslations("admin");
  const common = await getTranslations("common");
  // Newest first, 50 at a time, continuing from the oldest entry shown (?before=<id>): every page is
  // as quick as the first however far back it goes, where skipping rows (offset) got slower page by page.
  // Ids grow with time, so this is the order of the entries' times.
  const raw = Number((await searchParams).before);
  const before = Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_actor_id_fkey(display_name)")
    .order("id", { ascending: false })
    .limit(SIZE + 1);
  if (before) query = query.lt("id", before);
  const { data } = await query;
  const rows = (data ?? []).slice(0, SIZE);
  const older = (data ?? []).length > SIZE ? rows.at(-1)?.id : null;
  return (
    <>
      <PageHeader title={t("nav.audit")} description={t("auditDescription")} />
      <div className="relative overflow-x-auto rounded-xl border border-line">
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
      {before || older ? (
        <nav aria-label={t("nav.audit")} className="flex items-center justify-center gap-3">
          {before ? (
            <LinkButton href="/admin/audit" className={buttonClass("outline", "sm")}>
              {t("auditNewest")}
            </LinkButton>
          ) : null}
          {older ? (
            <LinkButton href={{ pathname: "/admin/audit", query: { before: String(older) } }} className={buttonClass("outline", "sm")} rel="next">
              {common("next")}
            </LinkButton>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
