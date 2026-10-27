import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { myTeams } from "@/server/teams/queries";
import { TeamCard } from "@/components/team/team-card";
import { buttonClass } from "@/components/ui/button";
import { Container, EmptyState, PageHeader } from "@/components/ui/primitives";

export default async function MyTeamsPage({ params }: PageProps<"/[locale]/my/teams">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/my/teams");
  const t = await getTranslations("teams");
  const teams = await myTeams(user.id);
  return (
    <Container className="py-10">
      <PageHeader title={t("mine")} actions={<Link href="/teams/new" className={buttonClass("primary", "md")}>{t("create")}</Link>} />
      {teams.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map(({ team, role }) => <TeamCard key={team.id} team={team} role={role} />)}
        </div>
      ) : (
        <EmptyState title={t("noneMine")} action={<Link href="/teams" className={buttonClass("primary", "md")}>{t("browse")}</Link>}>{t("noneMineBody")}</EmptyState>
      )}
    </Container>
  );
}
