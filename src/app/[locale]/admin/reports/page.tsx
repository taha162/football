import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { removeMessageAction, setHiddenAction, setUserStatusAction, updateReportAction } from "@/server/admin";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Select, Textarea } from "@/components/ui/field";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

const STATUSES = ["open", "in_review", "resolved", "dismissed"] as const;

function targetHref(type: string, id: string, snapshot: Record<string, unknown>): string | null {
  switch (type) {
    case "user": return `/players/${id}`;
    case "match": return `/matches/${id}`;
    case "team": return `/teams/${id}`;
    case "venue": return `/venues/${id}`;
    case "tournament": return `/tournaments/${id}`;
    case "message": return snapshot.sender_id ? `/players/${String(snapshot.sender_id)}` : null;
    default: return null;
  }
}

export default async function AdminReportsPage({ searchParams }: PageProps<"/[locale]/admin/reports">) {
  const t = await getTranslations("admin");
  const r = await getTranslations("report");
  const locale = await getLocale();
  const requested = (await searchParams).status;
  const status = STATUSES.find((s) => s === requested) ?? "open";
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("*, reporter:profiles!reports_reporter_id_fkey(id, display_name)")
    .eq("status", status)
    .order("created_at", { ascending: status === "open" })
    .limit(100);
  const rows = data ?? [];
  return (
    <>
      <PageHeader title={t("nav.reports")} description={t("reportsDescription")} />
      <nav className="flex flex-wrap gap-2" aria-label={t("reportStatus")}>
        {STATUSES.map((s) => (
          <LinkButton key={s} href={{ pathname: "/admin/reports", query: { status: s } }} aria-current={s === status ? "page" : undefined} className={buttonClass(s === status ? "secondary" : "ghost", "sm")}>
            {t(`reportStatuses.${s}`)}
          </LinkButton>
        ))}
      </nav>
      {rows.length === 0 ? <EmptyState title={t("noReports")} /> : null}
      <ul className="flex flex-col gap-4">
        {rows.map((rep) => {
          const snapshot = (rep.snapshot ?? {}) as Record<string, unknown>;
          const href = targetHref(rep.target_type, rep.target_id, snapshot);
          const hideable = ["match", "team", "venue", "tournament", "review"].includes(rep.target_type);
          const userTarget = rep.target_type === "user" ? rep.target_id : rep.target_type === "message" && snapshot.sender_id ? String(snapshot.sender_id) : null;
          return (
            <li key={rep.id}>
              <Card>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="danger">{r(`categories.${rep.category}`)}</Badge>
                    <Badge>{t(`targets.${rep.target_type}`)}</Badge>
                    <span className="text-xs text-muted">{formatDateTime(rep.created_at, locale, "Asia/Baghdad")}</span>
                    <span className="text-xs text-muted">· {t("reportedBy", { name: rep.reporter?.display_name ?? "—" })}</span>
                  </div>
                  {rep.details ? <p className="text-sm" dir="auto">{rep.details}</p> : null}
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-muted" dir="auto">{JSON.stringify(snapshot, null, 2)}</pre>
                  <div className="flex flex-wrap gap-2">
                    {href ? <LinkButton href={href} className={buttonClass("outline", "sm")}>{t("viewTarget")}</LinkButton> : null}
                    {hideable ? (
                      <ConfirmAction
                        action={setHiddenAction}
                        values={{ entity_type: rep.target_type, entity_id: rep.target_id, hidden: "1" }}
                        label={t("hideContent")}
                        title={t("hideContent")}
                        confirmLabel={t("hideContent")}
                        reasonName="reason"
                        reasonLabel={t("reason")}
                        reasonRequired
                      />
                    ) : null}
                    {rep.target_type === "message" && /^\d+$/.test(rep.target_id) ? (
                      <ConfirmAction
                        action={removeMessageAction}
                        values={{ message_id: rep.target_id }}
                        label={t("removeMessage")}
                        title={t("removeMessage")}
                        description={t("removeMessageDescription")}
                        confirmLabel={t("removeMessage")}
                        reasonName="reason"
                        reasonLabel={t("reason")}
                        reasonRequired
                      />
                    ) : null}
                    {userTarget ? (
                      <ConfirmAction
                        action={setUserStatusAction}
                        values={{ user_id: userTarget, status: "suspended" }}
                        label={t("suspendUser")}
                        title={t("suspendUser")}
                        description={t("suspendDescription")}
                        confirmLabel={t("suspend")}
                        reasonName="reason"
                        reasonLabel={t("reason")}
                        reasonRequired
                      />
                    ) : null}
                  </div>
                  <ActionForm action={updateReportAction} className="border-t border-line pt-3">
                    <Hidden values={{ report_id: rep.id }} />
                    <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                      <Select name="status" defaultValue={rep.status === "open" ? "in_review" : rep.status} aria-label={t("reportStatus")}>
                        {STATUSES.map((s) => <option key={s} value={s}>{t(`reportStatuses.${s}`)}</option>)}
                      </Select>
                      <Textarea name="note" defaultValue={rep.resolution_note ?? ""} maxLength={1000} placeholder={t("resolutionNote")} aria-label={t("resolutionNote")} className="min-h-11" />
                      <SubmitButton size="md">{t("update")}</SubmitButton>
                    </div>
                  </ActionForm>
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
