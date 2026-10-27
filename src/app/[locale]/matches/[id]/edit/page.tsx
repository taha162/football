import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { redirect } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { minutesBetween, toLocalInputValue } from "@/lib/format";
import { getMatch } from "@/server/matches/queries";
import { getAreas, getCities } from "@/server/reference";
import { venueOptions } from "@/server/options";
import { MatchForm } from "@/components/match/match-form";
import { Container, PageHeader } from "@/components/ui/primitives";

export default async function EditMatchPage({ params }: PageProps<"/[locale]/matches/[id]/edit">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/matches/${id}/edit`);
  const match = await getMatch(id);
  if (!match) notFound();
  // UI guard only; update_match re-checks authorization in the database.
  if (match.organizer_id !== user.id && match.match_type !== "team_vs_team") redirect({ href: `/matches/${id}`, locale });
  const t = await getTranslations("matchForm");
  const [cities, areas, venues] = await Promise.all([getCities(), getAreas(), venueOptions()]);
  const tz = match.city?.timezone ?? "Asia/Baghdad";
  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title={t("editTitle")} description={match.title} />
      <MatchForm
        mode="edit"
        cities={cities}
        areas={areas}
        venues={venues.filter((v) => v.city_id === match.city_id)}
        teams={[]}
        minStart={toLocalInputValue(new Date(), tz)}
        defaults={{
          id: match.id,
          title: match.title,
          description: match.description,
          city_id: match.city_id,
          area_id: match.area_id,
          venue_id: match.venue_id,
          field_id: match.field_id,
          location_note: match.location_note,
          start: toLocalInputValue(match.starts_at, tz),
          duration: minutesBetween(match.starts_at, match.ends_at),
          format: match.format,
          total_players: match.total_players,
          reserved_spots: match.reserved_spots,
          positions_needed: match.positions_needed as Record<string, number>,
          skill_level: match.skill_level,
          total_cost: match.total_cost,
          paying_players: match.paying_players,
          price_per_player: match.total_cost == null ? match.price_per_player : null,
          cost_is_estimate: match.cost_is_estimate,
          payment_collector: match.payment_collector,
          payment_notes: match.payment_notes,
          rules: match.rules,
          visibility: match.visibility,
          join_policy: match.join_policy,
          leave_deadline_hours: match.leave_deadline_hours,
          external_booking: match.booking_status === "external",
          match_type: match.match_type,
        }}
      />
    </Container>
  );
}
