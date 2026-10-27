import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { publicStorageUrl } from "@/lib/storage";
import { decideParticipantAction, participantDetailsAction, removeParticipantAction } from "@/server/matches/actions";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";

interface RosterRow {
  id: string;
  user_id: string;
  status: string;
  position: string | null;
  team_side: string | null;
  attendance: string | null;
  payment_status: string;
  late_withdrawal: boolean;
  promoted_from_waitlist: boolean;
  profile: { id: string; display_name: string; avatar_path: string | null; skill_level: string | null } | null;
}

export async function Roster({
  matchId,
  rows,
  waitlist,
  canManage,
  started,
  teamMatch,
  organizerId,
}: {
  matchId: string;
  rows: RosterRow[];
  waitlist: { id: string; user_id: string; profile: { display_name: string; avatar_path: string | null } | null }[];
  canManage: boolean;
  started: boolean;
  teamMatch: boolean;
  organizerId: string;
}) {
  const t = await getTranslations("roster");
  const e = await getTranslations("enums");
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <div className="flex flex-col gap-6">
      {canManage && pending.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">{t("pending", { count: pending.length })}</h3>
          <ul className="flex flex-col gap-2">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
                <PlayerLink row={r} />
                <div className="ms-auto flex gap-2">
                  <ActionForm action={decideParticipantAction} className="gap-1">
                    <Hidden values={{ participant_id: r.id, match_id: matchId, approve: "1" }} />
                    <SubmitButton size="sm">{t("approve")}</SubmitButton>
                  </ActionForm>
                  <ActionForm action={decideParticipantAction} className="gap-1">
                    <Hidden values={{ participant_id: r.id, match_id: matchId }} />
                    <SubmitButton size="sm" variant="ghost">{t("reject")}</SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {confirmed.length === 0 ? <li className="p-4 text-sm text-muted">{t("empty")}</li> : null}
        {confirmed.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-3">
              <PlayerLink row={r} />
              <div className="flex flex-wrap gap-1">
                {r.user_id === organizerId ? <Badge tone="accent">{t("organizer")}</Badge> : null}
                {r.position ? <Badge>{e(`position.${r.position}`)}</Badge> : null}
                {r.team_side ? <Badge tone="info">{t(`side.${r.team_side}`)}</Badge> : null}
                {r.promoted_from_waitlist ? <Badge tone="warning">{t("fromWaitlist")}</Badge> : null}
                {canManage && r.payment_status !== "unpaid" ? <Badge tone="success">{t(`payment.${r.payment_status}`)}</Badge> : null}
                {r.attendance ? <Badge tone={r.attendance === "no_show" ? "danger" : "neutral"}>{t(`attendance.${r.attendance}`)}</Badge> : null}
              </div>
            </div>
            {canManage ? (
              <div className="flex flex-wrap items-end gap-2">
                <ActionForm action={participantDetailsAction} className="flex-row flex-wrap items-end gap-2">
                  <Hidden values={{ participant_id: r.id, match_id: matchId }} />
                  {!teamMatch ? (
                    <label className="flex flex-col text-xs text-muted">
                      {t("sideLabel")}
                      <Select name="team_side" defaultValue={r.team_side ?? ""} className="h-9 w-28 text-sm">
                        <option value="">—</option>
                        <option value="home">{t("side.home")}</option>
                        <option value="away">{t("side.away")}</option>
                      </Select>
                    </label>
                  ) : null}
                  <label className="flex flex-col text-xs text-muted">
                    {t("paymentLabel")}
                    <Select name="payment_status" defaultValue={r.payment_status} className="h-9 w-32 text-sm">
                      <option value="unpaid">{t("payment.unpaid")}</option>
                      <option value="paid">{t("payment.paid")}</option>
                      <option value="waived">{t("payment.waived")}</option>
                    </Select>
                  </label>
                  {started ? (
                    <label className="flex flex-col text-xs text-muted">
                      {t("attendanceLabel")}
                      <Select name="attendance" defaultValue={r.attendance ?? ""} className="h-9 w-32 text-sm">
                        <option value="">—</option>
                        <option value="attended">{t("attendance.attended")}</option>
                        <option value="no_show">{t("attendance.no_show")}</option>
                        <option value="excused">{t("attendance.excused")}</option>
                      </Select>
                    </label>
                  ) : null}
                  <SubmitButton size="sm" variant="secondary">{t("update")}</SubmitButton>
                </ActionForm>
                {!started && r.user_id !== organizerId ? (
                  <ConfirmAction
                    action={removeParticipantAction}
                    values={{ participant_id: r.id, match_id: matchId }}
                    label={t("remove")}
                    title={t("removeTitle", { name: r.profile?.display_name ?? "" })}
                    description={t("removeDescription")}
                    confirmLabel={t("remove")}
                    reasonName="reason"
                    reasonLabel={t("reason")}
                  />
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage && waitlist.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">{t("waitlist", { count: waitlist.length })}</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {waitlist.map((w, i) => (
              <li key={w.id} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                <span className="num w-5 text-muted">{i + 1}</span>
                <Avatar src={publicStorageUrl("avatars", w.profile?.avatar_path)} name={w.profile?.display_name ?? "?"} size={28} />
                <Link href={`/players/${w.user_id}`} className="hover:underline">{w.profile?.display_name}</Link>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">{t("waitlistPolicy")}</p>
        </div>
      ) : null}
    </div>
  );
}

function PlayerLink({ row }: { row: RosterRow }) {
  return (
    <Link href={`/players/${row.user_id}`} className="flex items-center gap-3 hover:underline">
      <Avatar src={publicStorageUrl("avatars", row.profile?.avatar_path)} name={row.profile?.display_name ?? "?"} size={36} />
      <span className="font-medium">{row.profile?.display_name}</span>
    </Link>
  );
}
