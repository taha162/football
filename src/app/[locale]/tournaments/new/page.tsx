import { getTranslations, setRequestLocale } from "next-intl/server";
import { getNow } from "@/lib/now";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { todayIn, toLocalInputValue } from "@/lib/format";
import { getCities } from "@/server/reference";
import { venueOptions } from "@/server/options";
import { TournamentForm } from "@/components/tournament/tournament-form";
import { Container, PageHeader } from "@/components/ui/primitives";

export default async function NewTournamentPage({ params }: PageProps<"/[locale]/tournaments/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/tournaments/new");
  const t = await getTranslations("tournamentForm");
  const [cities, venues] = await Promise.all([getCities(), venueOptions()]);
  const tz = "Asia/Baghdad";
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("createTitle")} description={t("createDescription")} />
      <TournamentForm
        cities={cities}
        venues={venues}
        defaults={{
          city_id: user.profile.city_id ?? cities[0]?.id,
          deadline: toLocalInputValue(new Date(getNow() + 7 * 86_400_000), tz).slice(0, 10) + "T23:00",
          starts_on: todayIn(tz, 10),
          ends_on: todayIn(tz, 24),
        }}
      />
    </Container>
  );
}
