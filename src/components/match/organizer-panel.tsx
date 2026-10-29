import { getTranslations } from "next-intl/server";
import Form from "next/form";
import { getNow } from "@/lib/now";
import { Link } from "@/i18n/navigation";
import { publicStorageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { MatchDetail } from "@/server/matches/queries";
import { inviteToMatchAction, lifecycleAction, revokeMatchInvitationAction } from "@/server/matches/actions";
import { ActionForm, Hidden, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/primitives";

export async function OrganizerPanel({
  match,
  invitations,
  inviteQuery,
  rosterUserIds,
}: {
  match: MatchDetail;
  invitations: { id: string; invitee: { id: string; display_name: string; avatar_path: string | null } | null }[];
  inviteQuery?: string;
  rosterUserIds: string[];
}) {
  const t = await getTranslations("organizer");
  const started = new Date(match.starts_at) <= new Date();
  const active = !["completed", "cancelled"].includes(match.status);

  let candidates: { id: string; display_name: string; avatar_path: string | null }[] = [];
  if (inviteQuery && inviteQuery.length >= 2 && active) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_path")
      .ilike("display_name", `%${inviteQuery.replace(/[%_\\]/g, "")}%`)
      .eq("status", "active")
      .limit(8);
    const exclude = new Set([...rosterUserIds, match.organizer_id, ...invitations.map((i) => i.invitee?.id)]);
    candidates = (data ?? []).filter((p) => !exclude.has(p.id));
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <h2 className="font-display text-xl font-semibold">{t("title")}</h2>
        <div className="flex flex-wrap gap-2">
          {active && !started ? (
            <Link href={`/matches/${match.id}/edit`} className={buttonClass("secondary", "sm")}>{t("edit")}</Link>
          ) : null}
          {match.status === "draft" ? (
            <InlineAction action={lifecycleAction} values={{ match_id: match.id, op: "publish_match" }} label={t("publish")} variant="primary" />
          ) : null}
          {(match.status === "open" || match.status === "full") && !started ? (
            <InlineAction action={lifecycleAction} values={{ match_id: match.id, op: "confirm_match" }} label={t("confirm")} />
          ) : null}
          {["open", "full", "confirmed"].includes(match.status) && new Date(match.starts_at).getTime() - getNow() < 30 * 60_000 ? (
            <InlineAction action={lifecycleAction} values={{ match_id: match.id, op: "start_match" }} label={t("start")} />
          ) : null}
          {active && started && match.status !== "draft" ? (
            <InlineAction action={lifecycleAction} values={{ match_id: match.id, op: "complete_match" }} label={t("complete")} />
          ) : null}
          {active && !started && match.venue_id && match.booking_status !== "confirmed" && match.booking_status !== "requested" ? (
            <Link href={{ pathname: `/venues/${match.venue_id}/book`, query: { match: match.id } }} className={buttonClass("outline", "sm")}>
              {t("bookVenue")}
            </Link>
          ) : null}
          {active ? (
            <ConfirmAction
              action={lifecycleAction}
              values={{ match_id: match.id, op: "cancel_match" }}
              label={t("cancel")}
              title={t("cancelTitle")}
              description={match.booking_status === "confirmed" ? t("cancelWithBooking") : t("cancelDescription")}
              confirmLabel={t("cancelConfirm")}
              reasonName="reason"
              reasonLabel={t("cancelReason")}
            />
          ) : null}
        </div>

        {active && !started ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 className="font-semibold">{t("invite")}</h3>
            <Form action="" scroll={false} className="flex gap-2">
              <label className="sr-only" htmlFor="invite-q">{t("searchPlayers")}</label>
              <Input id="invite-q" name="invite" defaultValue={inviteQuery} placeholder={t("searchPlayers")} minLength={2} />
              <button type="submit" className={buttonClass("secondary", "md")}>{t("search")}</button>
            </Form>
            {inviteQuery && candidates.length === 0 ? <p className="text-sm text-muted">{t("noPlayersFound")}</p> : null}
            <ul className="flex flex-col gap-2">
              {candidates.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <Avatar src={publicStorageUrl("avatars", p.avatar_path)} name={p.display_name} size={32} />
                  <span className="flex-1 text-sm">{p.display_name}</span>
                  <ActionForm action={inviteToMatchAction} className="gap-1">
                    <Hidden values={{ match_id: match.id, user_id: p.id }} />
                    <SubmitButton size="sm">{t("sendInvite")}</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
            {invitations.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">{t("pendingInvitations")}</p>
                <ul className="flex flex-col gap-2">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 text-sm">
                      <span className="flex-1">{i.invitee?.display_name}</span>
                      <InlineAction action={revokeMatchInvitationAction} values={{ invitation_id: i.id, match_id: match.id }} label={t("revoke")} variant="ghost" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
