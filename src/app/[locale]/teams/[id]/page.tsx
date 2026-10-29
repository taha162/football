import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle, Settings, Swords } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { POSITIONS } from "@/lib/domain/match";
import { formatDate } from "@/lib/format";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { localizedName } from "@/server/reference";
import { getTeam, getTeamMatches, getTeamMembers, teamRecord } from "@/server/teams/queries";
import { leaveTeamAction, requestToJoinTeamAction, withdrawJoinRequestAction } from "@/server/teams/actions";
import { TeamLogo } from "@/components/team/team-card";
import { ReportButton } from "@/components/report-button";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Select, Textarea } from "@/components/ui/field";
import { Alert, Badge, Card, CardBody, Container, Section, Stat } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/teams/[id]">): Promise<Metadata> {
  const team = await getTeam((await params).id);
  return { title: team?.name ?? "—" };
}

export default async function TeamPage({ params }: PageProps<"/[locale]/teams/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const team = await getTeam(id);
  if (!team) notFound();
  const t = await getTranslations("teamPage");
  const e = await getTranslations("enums");
  const user = await getCurrentUser();
  const supabase = await createClient();
  const [members, matches, { data: recruitment }, myRequest, conversationId] = await Promise.all([
    getTeamMembers(id),
    getTeamMatches(id),
    supabase.from("team_recruitment").select("*").eq("team_id", id).eq("status", "open").gt("expires_at", new Date().toISOString()),
    user
      ? supabase.from("team_join_requests").select("id").eq("team_id", id).eq("user_id", user.id).eq("status", "pending").maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    user ? supabase.rpc("entity_conversation_id", { p_kind: "team", p_entity_id: id }).then((r) => r.data as string | null) : Promise.resolve(null),
  ]);
  const me = members.find((m) => m.user_id === user?.id);
  const isManager = me?.role === "captain" || me?.role === "manager";
  const record = teamRecord(id, matches);
  const tz = team.city?.timezone ?? "Asia/Baghdad";
  const canRequest = user && !me && !myRequest && team.visibility === "public" && team.join_policy === "request" && !team.is_archived;

  return (
    <Container className="py-8">
      {team.is_archived ? <Alert tone="warning" className="mb-4">{t("archived")}</Alert> : null}
      {team.is_hidden ? <Alert tone="warning" className="mb-4" title={t("hidden")}>{team.hidden_reason}</Alert> : null}
      <div className="reveal-children mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <TeamLogo path={team.logo_path} name={team.name} size={80} />
        <div className="flex flex-1 flex-col gap-1.5">
          <h1 className="page-title font-display text-3xl font-bold sm:text-4xl">{team.name}</h1>
          <p className="text-muted">{[localizedName(team.area, locale), localizedName(team.city, locale)].filter(Boolean).join("، ")}</p>
          <div className="flex flex-wrap gap-1.5">
            {team.preferred_format ? <Badge>{team.preferred_format}</Badge> : null}
            {team.preferred_formation ? <Badge>{team.preferred_formation}</Badge> : null}
            {team.skill_level ? <Badge tone="info">{e(`skill.${team.skill_level}`)}</Badge> : null}
            <Badge tone={team.visibility === "public" ? "neutral" : "warning"}>{t(`visibility.${team.visibility}`)}</Badge>
            {team.home_venue ? (
              <LinkButton href={`/venues/${team.home_venue.id}`}><Badge tone="accent">{t("homeVenue", { name: team.home_venue.name })}</Badge></LinkButton>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManager ? (
            <LinkButton href={`/teams/${id}/manage`} className={buttonClass("primary", "md")}>
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
          {user && !me && !team.is_archived ? (
            <LinkButton href={{ pathname: "/opponents", query: { target: id } }} className={buttonClass("outline", "md")}>
              <Swords aria-hidden="true" className="size-4" />
              {t("challenge")}
            </LinkButton>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          {team.description ? <p className="whitespace-pre-line text-muted">{team.description}</p> : null}

          <Section title={t("record")} id="record">
            <dl className="grid grid-cols-4 gap-3">
              <Stat label={t("played")} value={record.played} />
              <Stat label={t("won")} value={record.won} />
              <Stat label={t("drawn")} value={record.drawn} />
              <Stat label={t("lost")} value={record.lost} />
            </dl>
            <p className="text-xs text-muted">{t("recordNote")}</p>
          </Section>

          {(recruitment ?? []).length > 0 ? (
            <Section title={t("recruiting")} id="recruiting">
              <div className="flex flex-col gap-3">
                {(recruitment ?? []).map((r) => (
                  <Card key={r.id}>
                    <CardBody className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{r.title}</h3>
                        {r.positions.length === 0 ? <Badge tone="accent">{t("anyPosition")}</Badge> : r.positions.map((p) => <Badge key={p} tone="accent">{e(`position.${p}`)}</Badge>)}
                        <Badge>{t("needed", { count: r.players_needed })}</Badge>
                      </div>
                      {r.description ? <p className="text-sm text-muted">{r.description}</p> : null}
                      <p className="text-xs text-faint">{t("expires", { date: formatDate(r.expires_at, locale, tz) })}</p>
                      {user && !me && !myRequest ? (
                        <ActionForm action={requestToJoinTeamAction}>
                          <Hidden values={{ team_id: id, recruitment_id: r.id }} />
                          <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                            <Select name="position" aria-label={t("yourPosition")} defaultValue={r.positions[0] ?? ""}>
                              <option value="">{t("anyPosition")}</option>
                              {POSITIONS.map((p) => <option key={p} value={p}>{e(`position.${p}`)}</option>)}
                            </Select>
                            <Textarea name="message" maxLength={300} placeholder={t("messagePlaceholder")} aria-label={t("message")} className="min-h-11" />
                          </div>
                          <SubmitButton size="sm" className="self-start">{t("apply")}</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </CardBody>
                  </Card>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title={t("matches")} id="matches">
            {matches.length === 0 ? (
              <p className="text-sm text-muted">{t("noMatches")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                {matches.map((m) => {
                  const r = Array.isArray(m.result) ? m.result[0] : m.result;
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <Link href={`/matches/${m.id}`} className="hover:underline">{m.title}</Link>
                      <span className="num flex items-center gap-2 text-muted">
                        {r ? `${r.home_score}–${r.away_score}` : null}
                        {formatDate(m.starts_at, locale, m.city?.timezone ?? tz)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <h2 className="font-display text-lg font-semibold">{t("members", { count: members.length })}</h2>
              <ul className="flex flex-col gap-2">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3">
                    <Avatar src={publicStorageUrl("avatars", m.profile?.avatar_path)} name={m.profile?.display_name ?? "?"} size={32} />
                    <Link href={`/players/${m.user_id}`} className="flex-1 truncate text-sm hover:underline">{m.profile?.display_name}</Link>
                    {m.role !== "player" ? <Badge tone="accent">{t(`role.${m.role}`)}</Badge> : null}
                    {m.position ? <Badge>{e(`position.${m.position}`)}</Badge> : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          {canRequest ? (
            <Card>
              <CardBody>
                <ActionForm action={requestToJoinTeamAction}>
                  <Hidden values={{ team_id: id }} />
                  <h2 className="font-semibold">{t("requestToJoin")}</h2>
                  <Select name="position" aria-label={t("yourPosition")} defaultValue={user?.profile.positions[0] ?? ""}>
                    <option value="">{t("anyPosition")}</option>
                    {POSITIONS.map((p) => <option key={p} value={p}>{e(`position.${p}`)}</option>)}
                  </Select>
                  <Textarea name="message" maxLength={300} placeholder={t("messagePlaceholder")} aria-label={t("message")} />
                  <SubmitButton>{t("sendRequest")}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {myRequest ? (
            <Card>
              <CardBody className="flex flex-col gap-3">
                <p className="text-sm">{t("requestPending")}</p>
                <ActionForm action={withdrawJoinRequestAction}>
                  <Hidden values={{ request_id: myRequest.id, team_id: id }} />
                  <SubmitButton variant="ghost" size="sm">{t("withdraw")}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {!user ? (
            <LinkButton href={{ pathname: "/sign-in", query: { next: `/teams/${id}` } }} className={buttonClass("primary", "md")}>{t("signInToJoin")}</LinkButton>
          ) : null}
          {me ? (
            <ConfirmAction
              action={leaveTeamAction}
              values={{ team_id: id }}
              label={t("leave")}
              title={t("leaveTitle")}
              description={me.role === "captain" ? t("leaveCaptain") : t("leaveDescription")}
              confirmLabel={t("leave")}
            />
          ) : null}
          {user && !me ? <ReportButton targetType="team" targetId={id} /> : null}
        </aside>
      </div>
    </Container>
  );
}
