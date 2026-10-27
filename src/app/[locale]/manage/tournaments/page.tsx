import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button";
import { Badge, Container, EmptyState, PageHeader } from "@/components/ui/primitives";

export default async function MyTournamentsPage({ params }: PageProps<"/[locale]/manage/tournaments">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/manage/tournaments");
  const t = await getTranslations("tournament");
  const supabase = await createClient();
  const { data } = await supabase.from("tournaments").select("id, name, status, starts_on, teams:tournament_teams(status)").eq("organizer_id", user.id).order("starts_on", { ascending: false });
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("mine")} actions={<Link href="/tournaments/new" className={buttonClass("primary", "md")}>{t("create")}</Link>} />
      {(data ?? []).length === 0 ? (
        <EmptyState title={t("noneMine")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(data ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
              <Link href={`/tournaments/${r.id}/manage`} className="flex-1 font-semibold hover:underline">{r.name}</Link>
              <Badge>{t(`status.${r.status}`)}</Badge>
              <span className="num text-xs text-muted">{t("pendingCount", { count: (r.teams ?? []).filter((x) => x.status === "pending").length })}</span>
              <span className="text-xs text-muted">{formatDate(r.starts_on, locale, "UTC")}</span>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
