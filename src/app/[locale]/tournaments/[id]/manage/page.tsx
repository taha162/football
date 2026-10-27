import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link, redirect } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { toLocalInputValue } from "@/lib/format";
import { getCities } from "@/server/reference";
import { venueOptions } from "@/server/options";
import { getFixtures, getTournament, getTournamentTeams } from "@/server/tournaments/queries";
import { decideRegistrationAction, generateFixturesAction, postAnnouncementAction, setTournamentStatusAction } from "@/server/tournaments/actions";
import { FixtureList, type Fixture } from "@/components/tournament/fixtures";
import { TournamentForm } from "@/components/tournament/tournament-form";
import { ActionForm, FormField, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input, Textarea } from "@/components/ui/field";
import { Alert, Badge, Card, CardBody, Container, PageHeader, Section } from "@/components/ui/primitives";

export default async function ManageTournamentPage({ params }: PageProps<"/[locale]/tournaments/[id]/manage">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/tournaments/${id}/manage`);
  const tournament = await getTournament(id);
  if (!tournament) notFound();
  // UI guard only — every action is authorized again in the database.
  if (tournament.organizer_id !== user.id) redirect({ href: `/tournaments/${id}`, locale });
  const t = await getTranslations("tournamentManage");
  const tt = await getTranslations("tournament");
  const [teams, fixtures, cities, venues] = await Promise.all([getTournamentTeams(id), getFixtures(id) as Promise<Fixture[]>, getCities(), venueOptions()]);
  const tz = tournament.city?.timezone ?? "Asia/Baghdad";
  const names = Object.fromEntries(teams.map((x) => [x.team_id, x.team?.name ?? "—"]));
  const approved = teams.filter((x) => x.status === "approved").length;
  const s = tournament.status;
  const groupDone = fixtures.some((f) => f.stage === "group") && fixtures.filter((f) => f.stage === "group").every((f) => f.status !== "scheduled");
  const canGenerate =
    (s === "registration_closed" && fixtures.length === 0) ||
    (s === "in_progress" && tournament.tournament_format === "groups_knockout" && groupDone && !fixtures.some((f) => f.stage === "knockout"));

  return (
    <Container className="flex max-w-4xl flex-col gap-10 py-10">
      <PageHeader
        eyebrow={tt(`status.${s}`)}
        title={tournament.name}
        actions={<Link href={`/tournaments/${id}`} className={buttonClass("ghost", "md")}>{t("viewPublic")}</Link>}
      />

      <Section title={t("lifecycle")} id="lifecycle">
        <p className="text-sm text-muted">{t(`statusHelp.${s}`)}</p>
        <div className="flex flex-wrap gap-2">
          {s === "draft" || s === "registration_closed" ? (
            <InlineAction action={setTournamentStatusAction} values={{ tournament_id: id, status: "registration_open" }} label={t("openRegistration")} variant="primary" />
          ) : null}
          {s === "registration_open" ? (
            <InlineAction action={setTournamentStatusAction} values={{ tournament_id: id, status: "registration_closed" }} label={t("closeRegistration")} />
          ) : null}
          {canGenerate ? (
            <ActionForm action={generateFixturesAction}>
              <Hidden values={{ tournament_id: id }} />
              <SubmitButton>{fixtures.length === 0 ? t("generateFixtures", { count: approved }) : t("generateKnockout")}</SubmitButton>
            </ActionForm>
          ) : null}
          {s === "in_progress" ? (
            <InlineAction action={setTournamentStatusAction} values={{ tournament_id: id, status: "completed" }} label={t("complete")} />
          ) : null}
          {!["completed", "cancelled"].includes(s) ? (
            <ConfirmAction
              action={setTournamentStatusAction}
              values={{ tournament_id: id, status: "cancelled" }}
              label={t("cancel")}
              title={t("cancelTitle")}
              description={t("cancelDescription")}
              confirmLabel={t("cancel")}
            />
          ) : null}
        </div>
        {canGenerate ? <Alert tone="info">{t("generateNote")}</Alert> : null}
      </Section>

      <Section title={t("registrations", { approved, capacity: tournament.team_capacity })} id="registrations">
        {teams.length === 0 ? <p className="text-sm text-muted">{t("noRegistrations")}</p> : null}
        <ul className="flex flex-col gap-2">
          {teams.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
              <Link href={`/teams/${r.team_id}`} className="flex-1 font-medium hover:underline">{r.team?.name}</Link>
              <Badge tone={r.status === "approved" ? "success" : r.status === "pending" ? "warning" : "neutral"}>{tt(`registration.${r.status}`)}</Badge>
              {["pending", "waitlisted"].includes(r.status) && ["registration_open", "registration_closed"].includes(s) ? (
                <>
                  <InlineAction action={decideRegistrationAction} values={{ registration_id: r.id, tournament_id: id, approve: "1" }} label={t("approve")} variant="primary" />
                  <InlineAction action={decideRegistrationAction} values={{ registration_id: r.id, tournament_id: id }} label={t("reject")} variant="ghost" />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {fixtures.length > 0 ? (
        <Section title={t("fixtures")} id="fixtures">
          <FixtureList tournamentId={id} fixtures={fixtures} names={names} tz={tz} isOrganizer managedTeamIds={[]} inProgress={s === "in_progress"} />
        </Section>
      ) : null}

      <Section title={t("announce")} id="announce">
        <Card>
          <CardBody>
            <ActionForm action={postAnnouncementAction} resetOnSuccess>
              <Hidden values={{ tournament_id: id }} />
              <FormField name="title" label={t("announcementTitle")} required><Input required minLength={3} maxLength={120} /></FormField>
              <FormField name="body" label={t("announcementBody")} required><Textarea required maxLength={3000} /></FormField>
              <SubmitButton className="self-start">{t("post")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </Section>

      {["draft", "registration_open", "registration_closed"].includes(s) ? (
        <Section title={t("settings")} id="settings">
          <TournamentForm
            cities={cities}
            venues={venues}
            defaults={{
              id,
              name: tournament.name,
              description: tournament.description,
              city_id: tournament.city_id,
              venue_id: tournament.venue_id,
              format: tournament.format,
              tournament_format: tournament.tournament_format,
              team_capacity: tournament.team_capacity,
              group_count: tournament.group_count,
              advance_per_group: tournament.advance_per_group,
              min_team_size: tournament.min_team_size,
              deadline: toLocalInputValue(tournament.registration_deadline, tz),
              starts_on: tournament.starts_on,
              ends_on: tournament.ends_on,
              entry_fee: tournament.entry_fee,
              eligibility: tournament.eligibility,
              rules: tournament.rules,
              prizes: tournament.prizes,
              points_win: tournament.points_win,
              points_draw: tournament.points_draw,
              points_loss: tournament.points_loss,
              locked: s !== "draft",
            }}
          />
        </Section>
      ) : null}
    </Container>
  );
}
