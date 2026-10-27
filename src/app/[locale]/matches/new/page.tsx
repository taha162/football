import type { Metadata } from "next";
import { getNow } from "@/lib/now";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireOnboardedUser } from "@/lib/auth";
import { toLocalInputValue } from "@/lib/format";
import { getAreas, getCities } from "@/server/reference";
import { managedTeams, venueOptions } from "@/server/options";
import { MatchForm } from "@/components/match/match-form";
import { Container, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata({ params }: PageProps<"/[locale]/matches/new">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "matchForm" });
  return { title: t("createTitle") };
}

export default async function NewMatchPage({ params, searchParams }: PageProps<"/[locale]/matches/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, "/matches/new");
  const sp = await searchParams;
  const t = await getTranslations("matchForm");
  const [cities, areas, venues, teams] = await Promise.all([getCities(), getAreas(), venueOptions(), managedTeams(user.id)]);
  const city = cities.find((c) => c.id === user.profile.city_id) ?? cities[0];
  const tz = city?.timezone ?? "Asia/Baghdad";
  const tomorrow = toLocalInputValue(new Date(getNow() + 86_400_000), tz).slice(0, 10) + "T20:00";
  const teamId = typeof sp.team === "string" ? sp.team : undefined;
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("createTitle")} description={t("createDescription")} />
      <MatchForm
        mode="create"
        cities={cities}
        areas={areas}
        venues={venues}
        teams={teams}
        minStart={toLocalInputValue(new Date(getNow()), tz)}
        defaults={{
          city_id: city?.id,
          area_id: user.profile.area_id,
          start: tomorrow,
          venue_id: typeof sp.venue === "string" ? sp.venue : undefined,
          match_type: teamId ? "team_needs_players" : "open",
          team_id: teamId,
          format: (user.profile.preferred_formats[0] as "5v5" | undefined) ?? "5v5",
        }}
      />
    </Container>
  );
}
