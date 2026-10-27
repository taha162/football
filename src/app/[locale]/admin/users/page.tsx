import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { setRoleAction, setUserStatusAction } from "@/server/admin";
import { InlineAction } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/field";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";

export default async function AdminUsersPage({ searchParams }: PageProps<"/[locale]/admin/users">) {
  const locale = await getLocale();
  const me = await getCurrentUser();
  if (!me?.isAdmin) redirect({ href: "/admin", locale });
  const t = await getTranslations("admin");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_users", { p_search: q || undefined, p_limit: 51, p_offset: (page - 1) * 50 });
  const rows = (data ?? []).slice(0, 50);
  return (
    <>
      <PageHeader title={t("nav.users")} />
      <form method="get" className="flex gap-2">
        <label htmlFor="admin-user-q" className="sr-only">{t("searchUsers")}</label>
        <Input id="admin-user-q" name="q" defaultValue={q} placeholder={t("searchUsers")} />
        <button type="submit" className={buttonClass("secondary", "md")}>{t("search")}</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="p-2 text-start">{t("user")}</th>
              <th className="p-2 text-start">{t("email")}</th>
              <th className="p-2 text-start">{t("joined")}</th>
              <th className="p-2 text-start">{t("roles")}</th>
              <th className="p-2 text-start">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-line align-top">
                <td className="p-2">
                  <Link href={`/players/${u.id}`} className="font-medium hover:underline">{u.display_name}</Link>
                  {u.status === "suspended" ? <Badge tone="danger" className="ms-2">{t("suspended")}</Badge> : null}
                </td>
                <td className="p-2 text-muted" dir="ltr">{u.email}</td>
                <td className="p-2 text-muted">{formatDate(u.created_at, locale, "Asia/Baghdad")}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="accent">{t(`role.${r}`)}</Badge>)}</div>
                </td>
                <td className="p-2">
                  {u.id !== me!.id ? (
                    <div className="flex flex-wrap gap-1">
                      {u.status === "active" ? (
                        <ConfirmAction
                          action={setUserStatusAction}
                          values={{ user_id: u.id, status: "suspended" }}
                          label={t("suspend")}
                          title={t("suspendUser")}
                          description={t("suspendDescription")}
                          confirmLabel={t("suspend")}
                          reasonName="reason"
                          reasonLabel={t("reason")}
                          reasonRequired
                        />
                      ) : (
                        <InlineAction action={setUserStatusAction} values={{ user_id: u.id, status: "active" }} label={t("restore")} />
                      )}
                      {(["moderator", "admin"] as const).map((role) =>
                        u.roles.includes(role) ? (
                          <ConfirmAction key={role} action={setRoleAction} values={{ user_id: u.id, role }} label={t(`revoke.${role}`)} title={t(`revoke.${role}`)} confirmLabel={t(`revoke.${role}`)} variant="outline" />
                        ) : (
                          <ConfirmAction key={role} action={setRoleAction} values={{ user_id: u.id, role, grant: "1" }} label={t(`grant.${role}`)} title={t(`grant.${role}`)} description={t(`grantDescription.${role}`)} confirmLabel={t(`grant.${role}`)} variant="outline" />
                        ),
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted">{t("you")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pathname="/admin/users" query={q ? { q } : {}} page={page} hasMore={(data ?? []).length > 50} />
    </>
  );
}
