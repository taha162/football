import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { getAreas, getCities } from "@/server/reference";
import { TeamForm } from "@/components/team/team-form";
import { Container, PageHeader } from "@/components/ui/primitives";

export default async function NewTeamPage({ params }: PageProps<"/[locale]/teams/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/teams/new");
  const t = await getTranslations("teamForm");
  const [cities, areas] = await Promise.all([getCities(), getAreas()]);
  return (
    <Container className="max-w-2xl py-10">
      <PageHeader title={t("createTitle")} description={t("createDescription")} />
      <TeamForm cities={cities} areas={areas} venues={[]} defaults={{ city_id: user.profile.city_id, area_id: user.profile.area_id }} />
    </Container>
  );
}
