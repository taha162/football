import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, Info, MapPin, MessageCircle, Star, Timer, Wallet } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/domain/money";
import { formatDateTime, formatTime, minutesBetween } from "@/lib/format";
import { getMapProvider } from "@/lib/maps";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { localizedName } from "@/server/reference";
import { getMatch, getMatchEvents, getMatchInvitations, getMyMatchState, getRoster, getWaitlist } from "@/server/matches/queries";
import { OrganizerPanel } from "@/components/match/organizer-panel";
import { ParticipationPanel } from "@/components/match/participation-panel";
import { ResultPanel } from "@/components/match/result-panel";
import { Roster } from "@/components/match/roster";
import { ReportButton } from "@/components/report-button";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardBody, Container, Section } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/matches/[id]">): Promise<Metadata> {
  const { id } = await params;
  const match = await getMatch(id);
  return { title: match?.title ?? "—" };
}

export default async function MatchPage({ params, searchParams }: PageProps<"/[locale]/matches/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const match = await getMatch(id);
  if (!match) notFound();
  const t = await getTranslations("matchDetail");
  const m = await getTranslations("match");
  const e = await getTranslations("enums");
  const user = await getCurrentUser();
  const tz = match.city?.timezone ?? "Asia/Baghdad";
  const supabase = await createClient();

  // Organizer = creator, or (team matches) a manager of either team (checked again in the database).
  let isOrganizer = user?.id === match.organizer_id;
  let mySide: "home" | "away" | null = null;
  if (user && match.match_type === "team_vs_team") {
    const { data: memberships } = await supabase
      .from("team_members")
      .select("team_id, role")
      .eq("user_id", user.id)
      .in("team_id", [match.home_team_id, match.away_team_id].filter(Boolean) as string[]);
    for (const ms of memberships ?? []) {
      if (ms.role !== "player") {
        isOrganizer = true;
        mySide = ms.team_id === match.home_team_id ? "home" : "away";
      }
    }
  }

  const [roster, waitlist, invitations, mine, events, conversationId] = await Promise.all([
    user ? getRoster(match.id) : Promise.resolve([]),
    isOrganizer ? getWaitlist(match.id) : Promise.resolve([]),
    isOrganizer ? getMatchInvitations(match.id) : Promise.resolve([]),
    user ? getMyMatchState(match.id, user.id) : Promise.resolve(null),
    getMatchEvents(match.id),
    user ? supabase.rpc("entity_conversation_id", { p_kind: "match", p_entity_id: match.id }).then((r) => r.data as string | null) : Promise.resolve(null),
  ]);

  const started = new Date(match.starts_at) <= new Date();
  const isParticipant = mine?.participant?.status === "confirmed";
  const duration = minutesBetween(match.starts_at, match.ends_at);
  const point = match.venue?.latitude != null && match.venue?.longitude != null ? { lat: Number(match.venue.latitude), lng: Number(match.venue.longitude) } : null;
  const confirmedRoster = roster.filter((r) => r.status === "confirmed");
  const canReview = match.status === "completed" && (isParticipant || user?.id === match.organizer_id);

  return (
    <Container className="py-8">
      <div className="reveal-children mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={match.status === "cancelled" ? "danger" : match.status === "completed" ? "neutral" : "accent"}>{m(`status.${match.status}`)}</Badge>
          <Badge>{match.format}</Badge>
          <Badge tone="info">{m(`type.${match.match_type}`)}</Badge>
          {match.skill_level ? <Badge>{e(`skill.${match.skill_level}`)}</Badge> : <Badge>{t("allLevels")}</Badge>}
          {match.join_policy !== "open" ? <Badge tone="warning">{t(`policy.${match.join_policy}`)}</Badge> : null}
        </div>
        <h1 className="page-title font-display text-3xl font-bold sm:text-4xl">{match.title}</h1>
        {match.home_team && match.away_team ? (
          <p className="text-lg">
            <Link href={`/teams/${match.home_team.id}`} className="font-semibold hover:underline">{match.home_team.name}</Link>
            <span className="mx-2 text-muted">vs</span>
            <Link href={`/teams/${match.away_team.id}`} className="font-semibold hover:underline">{match.away_team.name}</Link>
          </p>
        ) : null}
        <div className="flex items-center gap-2 text-sm text-muted">
          <Avatar src={publicStorageUrl("avatars", match.organizer?.avatar_path)} name={match.organizer?.display_name ?? "?"} size={24} />
          {t("organizedBy")}{" "}
          <Link href={`/players/${match.organizer_id}`} className="text-ink hover:underline">{match.organizer?.display_name}</Link>
          {match.team ? (
            <>
              · <Link href={`/teams/${match.team.id}`} className="text-ink hover:underline">{match.team.name}</Link>
            </>
          ) : null}
        </div>
      </div>

      {match.status === "cancelled" ? (
        <Alert tone="danger" title={t("cancelledTitle")} className="mb-6">
          {match.cancelled_reason ?? t("cancelledNoReason")}
        </Alert>
      ) : null}
      {match.is_hidden ? <Alert tone="warning" title={t("hiddenTitle")} className="mb-6">{match.hidden_reason}</Alert> : null}
      {match.status === "draft" ? <Alert tone="info" title={t("draftTitle")} className="mb-6">{t("draftBody")}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Fact icon={<CalendarClock className="size-5" />} label={t("when")}>
                <time dateTime={match.starts_at}>{formatDateTime(match.starts_at, locale, tz, { weekday: "long", month: "long" })}</time>
                <span className="block text-xs text-muted">
                  {t("until", { time: formatTime(match.ends_at, locale, tz) })} · {t("timezoneNote", { tz })}
                </span>
              </Fact>
              <Fact icon={<Timer className="size-5" />} label={t("duration")}>{t("minutes", { count: duration })}</Fact>
              <Fact icon={<MapPin className="size-5" />} label={t("where")}>
                {match.venue ? (
                  <Link href={`/venues/${match.venue.id}`} className="font-medium hover:underline">{match.venue.name}</Link>
                ) : null}
                {match.field ? <span className="block text-sm text-muted">{match.field.name}</span> : null}
                <span className="block text-sm text-muted">
                  {[localizedName(match.area, locale), localizedName(match.city, locale)].filter(Boolean).join("، ")}
                </span>
                {match.location_note ? <span className="block text-sm text-muted">{match.location_note}</span> : null}
                {point && (isParticipant || isOrganizer) ? (
                  <a href={getMapProvider().directionsUrl(point)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-accent hover:underline">
                    {t("directions")}
                  </a>
                ) : null}
              </Fact>
              <Fact icon={<Info className="size-5" />} label={t("bookingStatus")}>
                <span className={match.booking_status === "confirmed" ? "text-success" : undefined}>{m(`booking.${match.booking_status}`)}</span>
                <span className="block text-xs text-muted">{t(`bookingExplain.${match.booking_status}`)}</span>
              </Fact>
            </CardBody>
          </Card>

          <Section title={t("costTitle")} id="cost">
            <Card>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Wallet aria-hidden="true" className="size-5 text-accent" />
                  <p className="num font-display text-2xl font-bold">
                    {match.price_per_player > 0 ? formatMoney(match.price_per_player, match.currency, locale) : m("free")}
                    {match.price_per_player > 0 ? <span className="ms-2 text-sm font-normal text-muted">{m("perPlayer")}</span> : null}
                  </p>
                  {match.price_per_player > 0 ? (
                    <Badge tone={match.cost_is_estimate ? "warning" : "success"}>{match.cost_is_estimate ? t("estimate") : t("confirmedAmount")}</Badge>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  {match.total_cost != null ? (
                    <li>{t("totalCost", { amount: formatMoney(match.total_cost, match.currency, locale), players: match.paying_players ?? match.total_players })}</li>
                  ) : null}
                  <li>{t(`collector.${match.payment_collector}`)}</li>
                  {match.payment_notes ? <li>{match.payment_notes}</li> : null}
                  <li>{t("leavePolicy", { hours: match.leave_deadline_hours })}</li>
                  <li>{t("noOnlinePayment")}</li>
                </ul>
              </CardBody>
            </Card>
          </Section>

          {match.description || match.rules ? (
            <Section title={t("about")} id="about">
              <Card>
                <CardBody className="flex flex-col gap-3 whitespace-pre-line text-sm">
                  {match.description ? <p>{match.description}</p> : null}
                  {match.rules ? (
                    <div>
                      <p className="mb-1 font-semibold">{t("rules")}</p>
                      <p className="text-muted">{match.rules}</p>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </Section>
          ) : null}

          {Object.keys(match.positions_needed as object).length > 0 ? (
            <Section title={t("positionsNeeded")} id="positions">
              <div className="flex flex-wrap gap-2">
                {Object.entries(match.positions_needed as Record<string, number>).map(([p, n]) => (
                  <Badge key={p} tone="info">{e(`position.${p}`)} × {n}</Badge>
                ))}
              </div>
            </Section>
          ) : null}

          <ResultPanel
            match={match}
            canReport={isOrganizer && started}
            mySide={mySide}
            canRecordEvents={user?.id === match.organizer_id}
            roster={confirmedRoster.map((r) => ({ user_id: r.user_id, name: r.profile?.display_name ?? "?" }))}
            events={events}
          />

          <Section
            title={t("roster", { count: match.confirmed_count + match.reserved_spots, total: match.total_players })}
            id="roster"
          >
            {match.reserved_spots > 0 ? <p className="text-sm text-muted">{t("reservedNote", { count: match.reserved_spots })}</p> : null}
            {user ? (
              <Roster
                matchId={match.id}
                rows={roster}
                waitlist={waitlist}
                canManage={isOrganizer}
                started={started}
                teamMatch={match.match_type === "team_vs_team"}
                organizerId={match.organizer_id}
              />
            ) : (
              <p className="text-sm text-muted">{t("rosterSignedOut", { count: match.confirmed_count })}</p>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <ParticipationPanel match={match} user={user} mine={mine} isOrganizer={isOrganizer} />
          {conversationId ? (
            <LinkButton href={`/messages/${conversationId}`} className={buttonClass("secondary", "md")}>
              <MessageCircle aria-hidden="true" className="size-4" />
              {t("chat")}
            </LinkButton>
          ) : null}
          {canReview ? (
            <LinkButton href={`/matches/${match.id}/review`} className={buttonClass("outline", "md")}>
              <Star aria-hidden="true" className="size-4" />
              {t("review")}
            </LinkButton>
          ) : null}
          {isOrganizer ? (
            <OrganizerPanel
              match={match}
              invitations={invitations}
              inviteQuery={typeof sp.invite === "string" ? sp.invite.slice(0, 40) : undefined}
              rosterUserIds={roster.map((r) => r.user_id)}
            />
          ) : null}
          {user && !isOrganizer ? (
            <div className="flex justify-end">
              <ReportButton targetType="match" targetId={match.id} />
            </div>
          ) : null}
        </div>
      </div>
    </Container>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 text-accent">{icon}</span>
      <div className="flex flex-col">
        <span className="text-xs text-muted">{label}</span>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}
