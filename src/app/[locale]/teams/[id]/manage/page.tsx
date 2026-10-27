import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link, redirect } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { POSITIONS, SKILL_LEVELS } from "@/lib/domain/match";
import { formatDate } from "@/lib/format";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { getAreas, getCities } from "@/server/reference";
import { venueOptions } from "@/server/options";
import { getTeam, getTeamMembers } from "@/server/teams/queries";
import {
  archiveTeamAction,
  closeRecruitmentAction,
  createRecruitmentAction,
  decideJoinRequestAction,
  inviteToTeamAction,
  removeMemberAction,
  revokeTeamInvitationAction,
  setMemberRoleAction,
  uploadTeamLogoAction,
} from "@/server/teams/actions";
import { TeamForm } from "@/components/team/team-form";
import { TeamLogo } from "@/components/team/team-card";
import { ActionForm, FormField, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ChoiceChips, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, CardBody, Container, PageHeader, Section } from "@/components/ui/primitives";

export default async function ManageTeamPage({ params, searchParams }: PageProps<"/[locale]/teams/[id]/manage">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireOnboardedUser(locale as Locale, `/teams/${id}/manage`);
  const team = await getTeam(id);
  if (!team) notFound();
  const members = await getTeamMembers(id);
  const me = members.find((m) => m.user_id === user.id);
  // UI guard only; every action is authorized again by the database.
  if (!me || me.role === "player") redirect({ href: `/teams/${id}`, locale });
  const isCaptain = me!.role === "captain";
  const t = await getTranslations("teamManage");
  const e = await getTranslations("enums");
  const sp = await searchParams;
  const q = typeof sp.invite === "string" ? sp.invite.slice(0, 40) : "";
  const supabase = await createClient();
  const [cities, areas, venues, { data: requests }, { data: invitations }, { data: recruitment }] = await Promise.all([
    getCities(),
    getAreas(),
    venueOptions(),
    supabase.from("team_join_requests").select("*, profile:profiles!team_join_requests_user_id_fkey(id, display_name, avatar_path, positions, skill_level)").eq("team_id", id).eq("status", "pending").order("created_at"),
    supabase.from("team_invitations").select("id, invitee:profiles!team_invitations_invitee_id_fkey(id, display_name)").eq("team_id", id).eq("status", "pending"),
    supabase.from("team_recruitment").select("*").eq("team_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  let candidates: { id: string; display_name: string; avatar_path: string | null }[] = [];
  if (q.length >= 2) {
    const { data } = await supabase.from("profiles").select("id, display_name, avatar_path").ilike("display_name", `%${q.replace(/[%_\\]/g, "")}%`).eq("status", "active").limit(8);
    const exclude = new Set([...members.map((m) => m.user_id), ...(invitations ?? []).map((i) => i.invitee?.id)]);
    candidates = (data ?? []).filter((p) => !exclude.has(p.id));
  }
  const tz = team.city?.timezone ?? "Asia/Baghdad";

  return (
    <Container className="flex max-w-4xl flex-col gap-10 py-10">
      <PageHeader
        title={t("title", { name: team.name })}
        actions={
          <>
            <Link href={`/teams/${id}`} className={buttonClass("ghost", "md")}>{t("viewPublic")}</Link>
            <Link href={{ pathname: "/matches/new", query: { team: id } }} className={buttonClass("outline", "md")}>{t("needPlayers")}</Link>
            <Link href={{ pathname: "/opponents", query: { team: id } }} className={buttonClass("primary", "md")}>{t("findOpponent")}</Link>
          </>
        }
      />

      {(requests ?? []).length > 0 ? (
        <Section title={t("requests", { count: requests!.length })} id="requests">
          <ul className="flex flex-col gap-2">
            {requests!.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
                <Avatar src={publicStorageUrl("avatars", r.profile?.avatar_path)} name={r.profile?.display_name ?? "?"} size={36} />
                <div className="flex flex-1 flex-col">
                  <Link href={`/players/${r.user_id}`} className="font-medium hover:underline">{r.profile?.display_name}</Link>
                  <span className="text-xs text-muted">
                    {r.position ? e(`position.${r.position}`) : null} {r.message ? `— ${r.message}` : null}
                  </span>
                </div>
                <InlineAction action={decideJoinRequestAction} values={{ request_id: r.id, team_id: id, approve: "1" }} label={t("approve")} variant="primary" />
                <InlineAction action={decideJoinRequestAction} values={{ request_id: r.id, team_id: id }} label={t("reject")} variant="ghost" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={t("roster")} id="roster">
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 p-3">
              <Avatar src={publicStorageUrl("avatars", m.profile?.avatar_path)} name={m.profile?.display_name ?? "?"} size={32} />
              <span className="flex-1 text-sm font-medium">{m.profile?.display_name}</span>
              <Badge tone={m.role === "player" ? "neutral" : "accent"}>{t(`role.${m.role}`)}</Badge>
              {isCaptain && m.user_id !== user.id ? (
                <ActionForm action={setMemberRoleAction} className="flex-row items-center gap-2">
                  <Hidden values={{ team_id: id, user_id: m.user_id }} />
                  <Select name="role" defaultValue={m.role} aria-label={t("roleFor", { name: m.profile?.display_name ?? "" })} className="h-9 w-32 text-sm">
                    <option value="player">{t("role.player")}</option>
                    <option value="manager">{t("role.manager")}</option>
                    <option value="captain">{t("role.captain")}</option>
                  </Select>
                  <SubmitButton size="sm" variant="secondary">{t("setRole")}</SubmitButton>
                </ActionForm>
              ) : null}
              {m.user_id !== user.id && (isCaptain || m.role === "player") ? (
                <ConfirmAction
                  action={removeMemberAction}
                  values={{ team_id: id, user_id: m.user_id }}
                  label={t("remove")}
                  title={t("removeTitle", { name: m.profile?.display_name ?? "" })}
                  confirmLabel={t("remove")}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t("captainNote")}</p>
      </Section>

      <Section title={t("invite")} id="invite">
        <form method="get" className="flex gap-2">
          <label htmlFor="team-invite" className="sr-only">{t("searchPlayers")}</label>
          <Input id="team-invite" name="invite" defaultValue={q} placeholder={t("searchPlayers")} minLength={2} />
          <button type="submit" className={buttonClass("secondary", "md")}>{t("search")}</button>
        </form>
        {q && candidates.length === 0 ? <p className="text-sm text-muted">{t("noPlayersFound")}</p> : null}
        <ul className="flex flex-col gap-2">
          {candidates.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <Avatar src={publicStorageUrl("avatars", p.avatar_path)} name={p.display_name} size={32} />
              <span className="flex-1 text-sm">{p.display_name}</span>
              <InlineAction action={inviteToTeamAction} values={{ team_id: id, user_id: p.id }} label={t("sendInvite")} variant="primary" />
            </li>
          ))}
        </ul>
        {(invitations ?? []).length > 0 ? (
          <ul className="flex flex-col gap-2 text-sm">
            {invitations!.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span className="flex-1 text-muted">{t("invited", { name: i.invitee?.display_name ?? "" })}</span>
                <InlineAction action={revokeTeamInvitationAction} values={{ invitation_id: i.id, team_id: id }} label={t("revoke")} variant="ghost" />
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title={t("recruitment")} id="recruitment">
        <Card>
          <CardBody>
            <ActionForm action={createRecruitmentAction} resetOnSuccess>
              <Hidden values={{ team_id: id }} />
              <FormField name="title" label={t("recruitTitle")} required>
                <Input required minLength={3} maxLength={100} placeholder={t("recruitTitlePlaceholder")} />
              </FormField>
              <ChoiceChips name="positions" legend={t("recruitPositions")} options={POSITIONS.map((p) => ({ value: p, label: e(`position.${p}`) }))} />
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField name="players_needed" label={t("playersNeeded")}>
                  <Input type="number" min={1} max={30} defaultValue={1} />
                </FormField>
                <FormField name="skill_level" label={t("skill")}>
                  <Select defaultValue="">
                    <option value="">{t("anyLevel")}</option>
                    {SKILL_LEVELS.map((s) => <option key={s} value={s}>{e(`skill.${s}`)}</option>)}
                  </Select>
                </FormField>
                <FormField name="expires_in_days" label={t("expiresIn")}>
                  <Select defaultValue="14">
                    {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{t("days", { count: d })}</option>)}
                  </Select>
                </FormField>
              </div>
              <FormField name="description" label={t("recruitDescription")}>
                <Textarea maxLength={1000} />
              </FormField>
              <SubmitButton className="self-start">{t("publishRecruitment")}</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <ul className="flex flex-col gap-2">
          {(recruitment ?? []).map((r) => {
            const open = r.status === "open" && new Date(r.expires_at) > new Date();
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
                <span className="flex-1 font-medium">{r.title}</span>
                <Badge tone={open ? "success" : "neutral"}>{open ? t("open") : t("closed")}</Badge>
                <span className="text-xs text-muted">{formatDate(r.expires_at, locale, tz)}</span>
                {open ? <InlineAction action={closeRecruitmentAction} values={{ recruitment_id: r.id, team_id: id }} label={t("close")} variant="ghost" /> : null}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("details")} id="details">
        <div className="flex items-center gap-4">
          <TeamLogo path={team.logo_path} name={team.name} size={64} />
          <ActionForm action={uploadTeamLogoAction} resetOnSuccess className="flex-1">
            <Hidden values={{ team_id: id }} />
            <FormField name="logo" label={t("logo")} hint={t("logoHint")}>
              <Input type="file" accept="image/jpeg,image/png,image/webp" required className="py-2" />
            </FormField>
            <SubmitButton variant="secondary" size="sm" className="self-start">{t("uploadLogo")}</SubmitButton>
          </ActionForm>
        </div>
        <TeamForm
          cities={cities}
          areas={areas}
          venues={venues.filter((v) => v.city_id === team.city_id)}
          defaults={{
            id,
            name: team.name,
            description: team.description,
            city_id: team.city_id,
            area_id: team.area_id,
            visibility: team.visibility,
            join_policy: team.join_policy,
            skill_level: team.skill_level,
            preferred_format: team.preferred_format,
            preferred_formation: team.preferred_formation,
            home_venue_id: team.home_venue_id,
          }}
        />
      </Section>

      {isCaptain ? (
        <Section title={t("dangerZone")} id="danger">
          <ConfirmAction action={archiveTeamAction} values={{ team_id: id }} label={t("archive")} title={t("archiveTitle")} description={t("archiveDescription")} confirmLabel={t("archive")} />
        </Section>
      ) : null}
    </Container>
  );
}
