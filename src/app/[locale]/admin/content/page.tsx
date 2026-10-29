import { getLocale, getTranslations } from "next-intl/server";
import Form from "next/form";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cancelMatchAsModeratorAction, setHiddenAction } from "@/server/admin";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/field";
import { Badge, PageHeader } from "@/components/ui/primitives";

const KINDS = ["match", "team", "tournament"] as const;
type Kind = (typeof KINDS)[number];

export default async function AdminContentPage({ searchParams }: PageProps<"/[locale]/admin/content">) {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const sp = await searchParams;
  const kind: Kind = KINDS.find((k) => k === sp.kind) ?? "match";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80).replace(/[%_\\]/g, "") : "";
  const supabase = await createClient();
  let rows: { id: string; name: string; created_at: string; is_hidden: boolean; status?: string }[] = [];
  if (kind === "match") {
    let query = supabase.from("matches").select("id, title, created_at, is_hidden, status").order("created_at", { ascending: false }).limit(50);
    if (q) query = query.ilike("title", `%${q}%`);
    rows = ((await query).data ?? []).map((m) => ({ id: m.id, name: m.title, created_at: m.created_at, is_hidden: m.is_hidden, status: m.status }));
  } else if (kind === "team") {
    let query = supabase.from("teams").select("id, name, created_at, is_hidden").order("created_at", { ascending: false }).limit(50);
    if (q) query = query.ilike("name", `%${q}%`);
    rows = (await query).data ?? [];
  } else {
    let query = supabase.from("tournaments").select("id, name, created_at, is_hidden, status").order("created_at", { ascending: false }).limit(50);
    if (q) query = query.ilike("name", `%${q}%`);
    rows = (await query).data ?? [];
  }
  const href = (id: string) => (kind === "match" ? `/matches/${id}` : kind === "team" ? `/teams/${id}` : `/tournaments/${id}`);
  return (
    <>
      <PageHeader title={t("nav.content")} description={t("contentDescription")} />
      <Form action="" scroll={false} className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <label key={k} className={buttonClass(k === kind ? "secondary" : "ghost", "sm", "cursor-pointer")}>
            <input type="radio" name="kind" value={k} defaultChecked={k === kind} className="sr-only" />
            {t(`targets.${k}`)}
          </label>
        ))}
        <label htmlFor="content-q" className="sr-only">{t("search")}</label>
        <Input id="content-q" name="q" defaultValue={q} placeholder={t("search")} className="w-56" />
        <button type="submit" className={buttonClass("secondary", "sm")}>{t("search")}</button>
      </Form>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <Link href={href(r.id)} className="flex-1 font-medium hover:underline">{r.name}</Link>
            {r.status ? <Badge>{r.status}</Badge> : null}
            {r.is_hidden ? <Badge tone="danger">{t("hidden")}</Badge> : null}
            <span className="text-xs text-muted">{formatDate(r.created_at, locale, "Asia/Baghdad")}</span>
            <ConfirmAction
              action={setHiddenAction}
              values={{ entity_type: kind, entity_id: r.id, hidden: r.is_hidden ? undefined : "1" }}
              label={r.is_hidden ? t("unhide") : t("hideContent")}
              title={r.is_hidden ? t("unhide") : t("hideContent")}
              confirmLabel={r.is_hidden ? t("unhide") : t("hideContent")}
              reasonName={r.is_hidden ? undefined : "reason"}
              reasonLabel={t("reason")}
              reasonRequired={!r.is_hidden}
              variant={r.is_hidden ? "primary" : "danger"}
            />
            {kind === "match" && r.status && !["completed", "cancelled"].includes(r.status) ? (
              <ConfirmAction action={cancelMatchAsModeratorAction} values={{ match_id: r.id }} label={t("cancelMatch")} title={t("cancelMatch")} confirmLabel={t("cancelMatch")} reasonName="reason" reasonLabel={t("reason")} reasonRequired />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
