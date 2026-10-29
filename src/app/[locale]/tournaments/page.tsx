import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { localizedName } from "@/server/reference";
import { buttonClass } from "@/components/ui/button";
import { Badge, Container, EmptyState, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata({ params }: PageProps<"/[locale]/tournaments">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "tournament" });
  return { title: t("directory") };
}

export default async function TournamentsPage({ params, searchParams }: PageProps<"/[locale]/tournaments">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tournament");
  const past = (await searchParams).show === "past";
  const supabase = await createClient();
  let q = supabase
    .from("tournaments")
    .select("id, name, status, starts_on, ends_on, format, tournament_format, team_capacity, registration_deadline, city:cities(name_en, name_ar, timezone), teams:tournament_teams(status)")
    .neq("status", "draft")
    .limit(60);
  q = past ? q.in("status", ["completed", "cancelled"]).order("starts_on", { ascending: false }) : q.in("status", ["registration_open", "registration_closed", "in_progress"]).order("starts_on");
  const { data } = await q;
  const rows = data ?? [];
  return (
    <Container className="py-10">
      <PageHeader
        title={t("directory")}
        description={t("directoryDescription")}
        actions={
          <>
            <Link href={{ pathname: "/tournaments", query: past ? {} : { show: "past" } }} className={buttonClass("ghost", "md")}>{past ? t("showCurrent") : t("showPast")}</Link>
            <Link href="/tournaments/new" className={buttonClass("primary", "md")}>{t("create")}</Link>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Trophy className="size-10" />} title={t("empty")}>{t("emptyBody")}</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const approved = (r.teams ?? []).filter((x) => x.status === "approved").length;
            return (
              <li key={r.id} className="reveal card-hover spotlight relative flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-line-strong">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={r.status === "registration_open" ? "accent" : r.status === "in_progress" ? "info" : "neutral"}>{t(`status.${r.status}`)}</Badge>
                  <Badge>{r.format}</Badge>
                  <Badge>{t(`structureShort.${r.tournament_format}`)}</Badge>
                </div>
                <h2 className="font-display text-lg font-semibold">
                  <Link href={`/tournaments/${r.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">{r.name}</Link>
                </h2>
                <p className="text-sm text-muted">
                  {localizedName(r.city, locale)} · {formatDate(r.starts_on, locale, "UTC")} – {formatDate(r.ends_on, locale, "UTC")}
                </p>
                <p className="num text-sm">{t("teamsCount", { count: approved, capacity: r.team_capacity })}</p>
                {r.status === "registration_open" ? (
                  <p className="text-xs text-accent">{t("registerBy", { date: formatDate(r.registration_deadline, locale, r.city?.timezone ?? "Asia/Baghdad") })}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
