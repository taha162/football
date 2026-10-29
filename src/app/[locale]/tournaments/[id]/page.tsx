import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle, Settings } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/domain/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { managedTeams } from "@/server/options";
import { localizedName } from "@/server/reference";
import { getAnnouncements, getFixtures, getTournament, getTournamentTeams } from "@/server/tournaments/queries";
import { registerTeamAction, withdrawTeamAction } from "@/server/tournaments/actions";
import { FixtureList, StandingsTable, type Fixture } from "@/components/tournament/fixtures";
import { TeamLogo } from "@/components/team/team-card";
import { ReportButton } from "@/components/report-button";
import { ActionForm, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Alert, Badge, Card, CardBody, Container, DefinitionList, Section } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/tournaments/[id]">): Promise<Metadata> {
  const t = await getTournament((await params).id);
  return { title: t?.name ?? "—" };
}

export default async function TournamentPage({ params }: PageProps<"/[locale]/tournaments/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const tournament = await getTournament(id);
  if (!tournament) notFound();
  const t = await getTranslations("tournament");
  const user = await getCurrentUser();
  const [teams, fixtures, announcements, myTeams] = await Promise.all([
    getTournamentTeams(id),
    getFixtures(id) as Promise<Fixture[]>,
    getAnnouncements(id),
    user ? managedTeams(user.id) : Promise.resolve([]),
  ]);
  const supabase = await createClient();
  const conversationId = user ? ((await supabase.rpc("entity_conversation_id", { p_kind: "tournament", p_entity_id: id })).data as string | null) : null;
  const tz = tournament.city?.timezone ?? "Asia/Baghdad";
  const isOrganizer = user?.id === tournament.organizer_id;
  const names = Object.fromEntries(teams.map((x) => [x.team_id, x.team?.name ?? "—"]));
  const approved = teams.filter((x) => x.status === "approved");
  const order = approved.map((x) => x.team_id);
  const rules = { win: tournament.points_win, draw: tournament.points_draw, loss: tournament.points_loss };
  const myIds = myTeams.map((x) => x.id);
  const registrable = myTeams.filter((x) => !teams.some((r) => r.team_id === x.id && ["pending", "approved", "waitlisted"].includes(r.status)));
  const myRegistrations = teams.filter((r) => myIds.includes(r.team_id) && ["pending", "approved", "waitlisted"].includes(r.status));
  const groupFixtures = fixtures.filter((f) => f.stage === "group");
  const groupLabels = [...new Set(approved.map((x) => x.group_label).filter(Boolean))].sort() as string[];
  const regOpen = tournament.status === "registration_open" && new Date(tournament.registration_deadline) > new Date();

  return (
    <Container className="py-8">
      {tournament.is_hidden ? <Alert tone="warning" className="mb-4" title={t("hidden")}>{tournament.hidden_reason}</Alert> : null}
      <div className="reveal-children mb-8 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={regOpen ? "accent" : "neutral"}>{t(`status.${tournament.status}`)}</Badge>
          <Badge>{tournament.format}</Badge>
          <Badge>{t(`structureShort.${tournament.tournament_format}`)}</Badge>
        </div>
        <h1 className="page-title font-display text-3xl font-bold sm:text-4xl">{tournament.name}</h1>
        <p className="text-muted">
          {t("organizedBy")} <Link href={`/players/${tournament.organizer_id}`} className="text-ink hover:underline">{tournament.organizer?.display_name}</Link>
        </p>
        <div className="flex flex-wrap gap-2">
          {isOrganizer ? (
            <LinkButton href={`/tournaments/${id}/manage`} className={buttonClass("primary", "md")}>
              <Settings aria-hidden="true" className="size-4" />
              {t("manage")}
            </LinkButton>
          ) : null}
          {conversationId ? (
            <LinkButton href={`/messages/${conversationId}`} className={buttonClass("secondary", "md")}>
              <MessageCircle aria-hidden="true" className="size-4" />
              {t("chat")}
            </LinkButton>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          {announcements.length > 0 ? (
            <Section title={t("announcements")} id="announcements">
              <ul className="flex flex-col gap-3">
                {announcements.map((a) => (
                  <li key={a.id} className="rounded-xl border border-accent/20 bg-accent/5 p-4">
                    <p className="font-semibold">{a.title}</p>
                    <p className="whitespace-pre-line text-sm text-muted" dir="auto">{a.body}</p>
                    <time className="text-xs text-faint" dateTime={a.created_at}>{formatDateTime(a.created_at, locale, tz)}</time>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {groupFixtures.length > 0 ? (
            <Section title={t("standings")} id="standings">
              {groupLabels.length > 0 ? (
                groupLabels.map((g) => (
                  <div key={g} className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold text-muted">{t("group", { group: g })}</h3>
                    <StandingsTable
                      teamIds={approved.filter((x) => x.group_label === g).map((x) => x.team_id)}
                      fixtures={groupFixtures.filter((f) => f.group_label === g)}
                      names={names}
                      rules={rules}
                      order={order}
                      highlight={tournament.tournament_format === "groups_knockout" ? tournament.advance_per_group : 0}
                    />
                  </div>
                ))
              ) : (
                <StandingsTable teamIds={order} fixtures={groupFixtures} names={names} rules={rules} order={order} />
              )}
              <p className="text-xs text-muted">{t("tiebreakNote")}</p>
            </Section>
          ) : null}

          <Section title={t("fixtures")} id="fixtures">
            {fixtures.length === 0 ? (
              <p className="text-sm text-muted">{t("noFixtures")}</p>
            ) : (
              <FixtureList
                tournamentId={id}
                fixtures={fixtures}
                names={names}
                tz={tz}
                isOrganizer={isOrganizer}
                managedTeamIds={myIds}
                inProgress={tournament.status === "in_progress"}
              />
            )}
          </Section>

          {tournament.description || tournament.rules || tournament.eligibility || tournament.prizes ? (
            <Section title={t("about")} id="about">
              <Card>
                <CardBody className="flex flex-col gap-4 whitespace-pre-line text-sm" dir="auto">
                  {tournament.description ? <p>{tournament.description}</p> : null}
                  {tournament.eligibility ? <div><p className="font-semibold">{t("eligibility")}</p><p className="text-muted">{tournament.eligibility}</p></div> : null}
                  {tournament.rules ? <div><p className="font-semibold">{t("rules")}</p><p className="text-muted">{tournament.rules}</p></div> : null}
                  {tournament.prizes ? <div><p className="font-semibold">{t("prizes")}</p><p className="text-muted">{tournament.prizes}</p></div> : null}
                </CardBody>
              </Card>
            </Section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  { label: t("city"), value: localizedName(tournament.city, locale) },
                  { label: t("dates"), value: `${formatDate(tournament.starts_on, locale, "UTC")} – ${formatDate(tournament.ends_on, locale, "UTC")}` },
                  { label: t("deadline"), value: formatDateTime(tournament.registration_deadline, locale, tz) },
                  { label: t("venue"), value: tournament.venue ? <Link href={`/venues/${tournament.venue.id}`} className="hover:underline">{tournament.venue.name}</Link> : "—" },
                  { label: t("capacityLabel"), value: t("teamsCount", { count: approved.length, capacity: tournament.team_capacity }) },
                  { label: t("entryFee"), value: tournament.entry_fee ? formatMoney(tournament.entry_fee, tournament.currency, locale) : t("free") },
                  { label: t("pointsLabel"), value: t("pointsValue", rules) },
                ]}
              />
              {tournament.entry_fee ? <p className="mt-3 text-xs text-muted">{t("feeNote")}</p> : null}
            </CardBody>
          </Card>

          {user && regOpen && registrable.length > 0 ? (
            <Card>
              <CardBody>
                <ActionForm action={registerTeamAction}>
                  <Hidden values={{ tournament_id: id }} />
                  <h2 className="font-semibold">{t("register")}</h2>
                  <Select name="team_id" aria-label={t("chooseTeam")}>
                    {registrable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                  <p className="text-xs text-muted">{t("minTeamSize", { count: tournament.min_team_size })}</p>
                  <SubmitButton>{t("submitRegistration")}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {user && regOpen && myTeams.length === 0 ? (
            <Alert tone="info">{t("needTeam")} <Link href="/teams/new" className="text-accent underline">{t("createTeam")}</Link></Alert>
          ) : null}
          {myRegistrations.map((r) => (
            <Card key={r.id}>
              <CardBody className="flex flex-col gap-2">
                <p className="text-sm"><span className="font-semibold">{r.team?.name}</span> — {t(`registration.${r.status}`)}</p>
                {["draft", "registration_open", "registration_closed"].includes(tournament.status) ? (
                  <InlineAction action={withdrawTeamAction} values={{ tournament_id: id, team_id: r.team_id }} label={t("withdraw")} variant="ghost" />
                ) : null}
              </CardBody>
            </Card>
          ))}

          <Card>
            <CardBody className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-semibold">{t("teams")}</h2>
              {approved.length === 0 ? <p className="text-sm text-muted">{t("noTeams")}</p> : null}
              <ul className="flex flex-col gap-2">
                {approved.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <TeamLogo path={r.team?.logo_path ?? null} name={r.team?.name ?? ""} size={28} />
                    <Link href={`/teams/${r.team_id}`} className="flex-1 truncate text-sm hover:underline">{r.team?.name}</Link>
                    {r.group_label ? <Badge>{t("group", { group: r.group_label })}</Badge> : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          {user && !isOrganizer ? <ReportButton targetType="tournament" targetId={id} /> : null}
        </aside>
      </div>
    </Container>
  );
}
