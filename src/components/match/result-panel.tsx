import { getTranslations } from "next-intl/server";
import type { MatchDetail } from "@/server/matches/queries";
import { reportResultAction, respondResultAction, setEventsAction } from "@/server/matches/actions";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/field";
import { Badge, Card, CardBody } from "@/components/ui/primitives";

interface Result {
  home_score: number;
  away_score: number;
  status: "reported" | "confirmed" | "disputed";
  reported_side: "home" | "away" | null;
  dispute_reason: string | null;
}

export async function ResultPanel({
  match,
  canReport,
  mySide,
  roster,
  events,
  canRecordEvents,
}: {
  match: MatchDetail;
  canReport: boolean;
  mySide: "home" | "away" | null;
  roster: { user_id: string; name: string }[];
  events: { user_id: string; event_type: string }[];
  canRecordEvents: boolean;
}) {
  const t = await getTranslations("result");
  const result = (Array.isArray(match.result) ? match.result[0] : match.result) as Result | null | undefined;
  const homeLabel = match.home_team?.name ?? t("home");
  const awayLabel = match.away_team?.name ?? t("away");
  const started = new Date(match.starts_at) <= new Date();
  if (!started && !result) return null;
  const count = (uid: string, type: string) => events.filter((e) => e.user_id === uid && e.event_type === type).length;
  const tone = result?.status === "confirmed" ? "success" : result?.status === "disputed" ? "danger" : "warning";

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{t("title")}</h2>
          {result ? <Badge tone={tone}>{t(`status.${result.status}`)}</Badge> : null}
        </div>
        {result ? (
          <div className="flex items-center justify-center gap-6 py-2">
            <span className="text-end text-sm text-muted">{homeLabel}</span>
            <span className="num font-display text-4xl font-extrabold">
              {result.home_score} – {result.away_score}
            </span>
            <span className="text-sm text-muted">{awayLabel}</span>
          </div>
        ) : (
          <p className="text-sm text-muted">{t("none")}</p>
        )}
        {result?.status === "reported" ? <p className="text-xs text-muted">{match.match_type === "team_vs_team" ? t("awaitingOpponent") : t("organizerReported")}</p> : null}
        {result?.status === "disputed" && result.dispute_reason ? <p className="text-sm text-danger">{result.dispute_reason}</p> : null}

        {match.match_type === "team_vs_team" && result?.status === "reported" && mySide && mySide !== result.reported_side ? (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={respondResultAction}>
              <Hidden values={{ match_id: match.id, confirm: "1" }} />
              <SubmitButton size="sm">{t("confirm")}</SubmitButton>
            </ActionForm>
            <ConfirmAction
              action={respondResultAction}
              values={{ match_id: match.id }}
              label={t("dispute")}
              title={t("dispute")}
              confirmLabel={t("dispute")}
              reasonName="reason"
              reasonLabel={t("disputeReason")}
              reasonRequired
            />
          </div>
        ) : null}

        {canReport && match.status !== "cancelled" ? (
          <ActionForm action={reportResultAction} className="border-t border-line pt-4">
            <Hidden values={{ match_id: match.id }} />
            <p className="text-sm font-medium">{result ? t("correct") : t("report")}</p>
            <div className="flex items-end gap-3">
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                {homeLabel}
                <Input type="number" name="home_score" min={0} max={99} required defaultValue={result?.home_score} />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                {awayLabel}
                <Input type="number" name="away_score" min={0} max={99} required defaultValue={result?.away_score} />
              </label>
              <SubmitButton>{t("save")}</SubmitButton>
            </div>
          </ActionForm>
        ) : null}

        {canRecordEvents && match.status === "completed" && roster.length > 0 ? (
          <details className="border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-medium">{t("events")}</summary>
            <ActionForm action={setEventsAction} className="mt-3">
              <Hidden values={{ match_id: match.id }} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="py-1 text-start font-medium">{t("player")}</th>
                      <th className="py-1 font-medium">{t("goals")}</th>
                      <th className="py-1 font-medium">{t("assists")}</th>
                      <th className="py-1 font-medium">{t("cleanSheets")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((p) => (
                      <tr key={p.user_id} className="border-t border-line">
                        <td className="py-1.5">{p.name}</td>
                        {(["goal", "assist", "clean_sheet"] as const).map((type) => (
                          <td key={type} className="px-1 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={20}
                              name={`count_${type}_${p.user_id}`}
                              defaultValue={count(p.user_id, type)}
                              className="h-9 w-16 text-center"
                              aria-label={`${p.name} – ${t(type === "goal" ? "goals" : type === "assist" ? "assists" : "cleanSheets")}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SubmitButton size="sm" className="self-start">{t("saveEvents")}</SubmitButton>
            </ActionForm>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}
