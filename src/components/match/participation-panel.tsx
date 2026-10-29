import { getLocale, getTranslations } from "next-intl/server";
import type { CurrentUser } from "@/lib/auth";
import { isJoinableStatus, isLateWithdrawal, openSlots, POSITIONS } from "@/lib/domain/match";
import { formatDateTime } from "@/lib/format";
import type { MatchDetail } from "@/server/matches/queries";
import { joinMatchAction, leaveMatchAction, respondMatchInvitationAction } from "@/server/matches/actions";
import { Celebration } from "@/components/motion/celebrate";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Select } from "@/components/ui/field";
import { Alert, Card, CardBody } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/link-button";

interface MyState {
  participant: { status: string; position: string | null } | null;
  waitlistPosition: number | null;
  invitationId: string | null;
}

export async function ParticipationPanel({ match, user, mine, isOrganizer }: { match: MatchDetail; user: CurrentUser | null; mine: MyState | null; isOrganizer: boolean }) {
  const t = await getTranslations("matchDetail");
  const e = await getTranslations("enums");
  const locale = await getLocale();
  const slots = openSlots(match);
  const joinable = isJoinableStatus(match.status) && new Date(match.starts_at) > new Date();
  const tz = match.city?.timezone ?? "Asia/Baghdad";
  const deadline = new Date(new Date(match.starts_at).getTime() - match.leave_deadline_hours * 3_600_000);
  // Joining (or accepting an invitation) that ends confirmed is celebrated once, by whoever just did it.
  const joined = `joined:${match.id}`;

  const positionSelect = (
    <label className="flex flex-col gap-1 text-sm">
      {t("yourPosition")}
      <Select name="position" defaultValue={user?.profile.positions[0] ?? ""}>
        <option value="">{t("anyPosition")}</option>
        {POSITIONS.map((p) => (
          <option key={p} value={p}>{e(`position.${p}`)}</option>
        ))}
      </Select>
    </label>
  );

  let body: React.ReactNode;
  if (!user) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("signInToJoin")}</p>
        <LinkButton href={{ pathname: "/sign-in", query: { next: `/matches/${match.id}` } }} className={buttonClass("primary", "lg")}>
          {t("signInCta")}
        </LinkButton>
      </div>
    );
  } else if (mine?.participant?.status === "confirmed") {
    const late = isLateWithdrawal(match.starts_at, match.leave_deadline_hours);
    body = (
      <div className="flex flex-col gap-3">
        <Celebration on={joined}>
          <Alert tone="success" title={t("youreIn")}>
            {mine.participant.position ? e(`position.${mine.participant.position}`) : t("anyPosition")}
          </Alert>
        </Celebration>
        {joinable ? (
          <>
            <p className="text-xs text-muted">{t("leaveDeadlineInfo", { time: formatDateTime(deadline, locale, tz) })}</p>
            <ConfirmAction
              action={leaveMatchAction}
              values={{ match_id: match.id }}
              label={t("leave")}
              title={t("leaveTitle")}
              description={late ? t("leaveLateWarning") : t("leaveDescription")}
              confirmLabel={t("leaveConfirm")}
            />
          </>
        ) : null}
      </div>
    );
  } else if (mine?.participant?.status === "pending") {
    body = (
      <div className="flex flex-col gap-3">
        <Alert tone="info" title={t("pendingTitle")}>{t("pendingBody")}</Alert>
        <ConfirmAction action={leaveMatchAction} values={{ match_id: match.id }} label={t("withdrawRequest")} title={t("withdrawRequest")} confirmLabel={t("withdrawRequest")} />
      </div>
    );
  } else if (mine?.waitlistPosition != null) {
    body = (
      <div className="flex flex-col gap-3">
        <Alert tone="warning" title={t("waitlistTitle", { position: mine.waitlistPosition })}>{t("waitlistBody")}</Alert>
        <ConfirmAction action={leaveMatchAction} values={{ match_id: match.id }} label={t("leaveWaitlist")} title={t("leaveWaitlist")} confirmLabel={t("leaveWaitlist")} />
      </div>
    );
  } else if (mine?.invitationId && joinable) {
    body = (
      <div className="flex flex-col gap-3">
        <Alert tone="info" title={t("invitedTitle")}>{t("invitedBody")}</Alert>
        <ActionForm action={respondMatchInvitationAction} celebrate={joined}>
          <Hidden values={{ invitation_id: mine.invitationId, match_id: match.id, accept: "1" }} />
          {positionSelect}
          <SubmitButton size="lg">{t("acceptInvitation")}</SubmitButton>
        </ActionForm>
        <ActionForm action={respondMatchInvitationAction}>
          <Hidden values={{ invitation_id: mine.invitationId, match_id: match.id }} />
          <SubmitButton variant="ghost">{t("declineInvitation")}</SubmitButton>
        </ActionForm>
      </div>
    );
  } else if (!joinable) {
    body = <p className="text-sm text-muted">{t("notJoinable", { status: t(`statusLabel.${match.status}`) })}</p>;
  } else if (!user.profile.onboarded_at) {
    body = (
      <LinkButton href={{ pathname: "/onboarding", query: { next: `/matches/${match.id}` } }} className={buttonClass("primary", "lg")}>
        {t("completeProfile")}
      </LinkButton>
    );
  } else if (match.join_policy === "invite_only" && match.match_type !== "team_vs_team") {
    body = <p className="text-sm text-muted">{t("inviteOnly")}</p>;
  } else {
    body = (
      <ActionForm action={joinMatchAction} celebrate={joined}>
        <Hidden values={{ match_id: match.id, waitlist: slots > 0 ? undefined : "1" }} />
        {positionSelect}
        {match.price_per_player > 0 ? <p className="text-xs text-muted">{t("costReminder")}</p> : null}
        <SubmitButton size="lg">
          {slots > 0 ? (match.join_policy === "approval" ? t("requestToJoin") : t("join")) : t("joinWaitlist")}
        </SubmitButton>
        {slots === 0 ? <p className="text-xs text-muted">{t("waitlistExplain")}</p> : null}
      </ActionForm>
    );
  }

  return (
    <Card className="lg:sticky lg:top-20">
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-semibold">{t("participation")}</h2>
          <span className="num text-sm text-muted">{slots > 0 ? t("spotsOpen", { count: slots }) : t("noSpots")}</span>
        </div>
        {isOrganizer ? <p className="text-xs text-accent">{t("youOrganize")}</p> : null}
        {body}
      </CardBody>
    </Card>
  );
}
