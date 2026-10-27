import { getLocale, getTranslations } from "next-intl/server";
import { computeStandings, roundName } from "@/lib/domain/tournament";
import { formatDateTime } from "@/lib/format";
import { confirmTournamentResultAction, disputeTournamentResultAction, recordTournamentResultAction, scheduleFixtureAction } from "@/server/tournaments/actions";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { toLocalInputValue } from "@/lib/format";

export interface Fixture {
  id: string;
  stage: "group" | "knockout";
  round: number;
  match_number: number;
  group_label: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  scheduled_at: string | null;
  location_note: string | null;
  status: "scheduled" | "completed" | "cancelled";
  home_score: number | null;
  away_score: number | null;
  home_penalties: number | null;
  away_penalties: number | null;
  is_bye: boolean;
  winner_team_id: string | null;
  result_status: "none" | "submitted" | "confirmed" | "disputed";
  submitted_by: string | null;
  dispute_reason: string | null;
}

export async function StandingsTable({
  teamIds,
  fixtures,
  names,
  rules,
  order,
  highlight = 0,
}: {
  teamIds: string[];
  fixtures: Fixture[];
  names: Record<string, string>;
  rules: { win: number; draw: number; loss: number };
  order: string[];
  highlight?: number;
}) {
  const t = await getTranslations("tournament");
  const rows = computeStandings(teamIds, fixtures, rules, order);
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="num w-full text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th scope="col" className="p-2 text-start">#</th>
            <th scope="col" className="p-2 text-start">{t("team")}</th>
            <th scope="col" className="p-2" title={t("playedLong")}>{t("played")}</th>
            <th scope="col" className="p-2">{t("won")}</th>
            <th scope="col" className="p-2">{t("drawn")}</th>
            <th scope="col" className="p-2">{t("lost")}</th>
            <th scope="col" className="p-2" title={t("gdLong")}>{t("gd")}</th>
            <th scope="col" className="p-2">{t("points")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.teamId} className={i < highlight ? "border-t border-line bg-accent/5" : "border-t border-line"}>
              <td className="p-2">{i + 1}</td>
              <th scope="row" className="p-2 text-start font-medium">{names[r.teamId] ?? "—"}</th>
              <td className="p-2 text-center">{r.played}</td>
              <td className="p-2 text-center">{r.won}</td>
              <td className="p-2 text-center">{r.drawn}</td>
              <td className="p-2 text-center">{r.lost}</td>
              <td className="p-2 text-center" dir="ltr">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
              <td className="p-2 text-center font-bold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function FixtureList({
  tournamentId,
  fixtures,
  names,
  tz,
  isOrganizer,
  managedTeamIds,
  inProgress,
}: {
  tournamentId: string;
  fixtures: Fixture[];
  names: Record<string, string>;
  tz: string;
  isOrganizer: boolean;
  managedTeamIds: string[];
  inProgress: boolean;
}) {
  const t = await getTranslations("tournament");
  const locale = await getLocale();
  const knockoutRounds = Math.max(0, ...fixtures.filter((f) => f.stage === "knockout").map((f) => f.round));
  // A league is stored as a single group; only name groups when there are several.
  const multipleGroups = new Set(fixtures.filter((f) => f.stage === "group").map((f) => f.group_label)).size > 1;
  const groups = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const key = f.stage === "group" ? `g:${f.group_label ?? "-"}:${f.round}` : `k:${f.round}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const label = (key: string) => {
    const [stage, a, b] = key.split(":");
    if (stage === "k") {
      const n = roundName(Number(a), knockoutRounds);
      return n === "round_of" ? t("roundOf", { count: 2 ** (knockoutRounds - Number(a) + 1) }) : t(n);
    }
    return a !== "-" && multipleGroups ? t("groupRound", { group: a, round: Number(b) }) : t("round", { round: Number(b) });
  };

  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} aria-label={label(key)} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted">{label(key)}</h3>
          <ul className="flex flex-col gap-2">
            {list.map((f) => {
              const canSubmit = !isOrganizer && inProgress && f.status === "scheduled" && !f.is_bye && f.home_team_id && f.away_team_id &&
                (managedTeamIds.includes(f.home_team_id) || managedTeamIds.includes(f.away_team_id)) && f.result_status !== "confirmed";
              const canDispute = !isOrganizer && f.result_status === "submitted" && f.home_team_id && f.away_team_id &&
                (managedTeamIds.includes(f.home_team_id) || managedTeamIds.includes(f.away_team_id));
              return (
                <li key={f.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center gap-3">
                    <span className={`flex-1 text-end text-sm ${f.winner_team_id && f.winner_team_id === f.home_team_id ? "font-bold" : ""}`}>{f.home_team_id ? names[f.home_team_id] : f.is_bye ? t("bye") : t("tbd")}</span>
                    <span className="num min-w-20 rounded-lg bg-surface-3 px-2 py-1 text-center font-display font-bold" dir="ltr">
                      {f.home_score != null && f.away_score != null ? `${f.home_score} – ${f.away_score}` : "vs"}
                      {f.home_penalties != null ? <span className="block text-[10px] font-normal text-muted">({f.home_penalties}–{f.away_penalties} {t("pens")})</span> : null}
                    </span>
                    <span className={`flex-1 text-sm ${f.winner_team_id && f.winner_team_id === f.away_team_id ? "font-bold" : ""}`}>{f.away_team_id ? names[f.away_team_id] : f.is_bye ? t("bye") : t("tbd")}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
                    {f.scheduled_at ? <time dateTime={f.scheduled_at}>{formatDateTime(f.scheduled_at, locale, tz)}</time> : null}
                    {f.location_note ? <span>· {f.location_note}</span> : null}
                    {f.is_bye ? <Badge>{t("byeAdvance")}</Badge> : null}
                    {f.result_status === "submitted" ? <Badge tone="warning">{t("resultSubmitted")}</Badge> : null}
                    {f.result_status === "disputed" ? <Badge tone="danger">{t("resultDisputed")}</Badge> : null}
                  </div>
                  {f.dispute_reason && (isOrganizer || canDispute) ? <p className="text-center text-xs text-danger">{f.dispute_reason}</p> : null}
                  {(isOrganizer && inProgress && !f.is_bye && f.home_team_id && f.away_team_id) || canSubmit ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-center text-xs text-accent">{isOrganizer ? t("recordResult") : t("submitResult")}</summary>
                      <ActionForm action={recordTournamentResultAction} className="mt-2">
                        <Hidden values={{ match_id: f.id, tournament_id: tournamentId }} />
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" name="home_score" min={0} max={99} required defaultValue={f.home_score ?? undefined} aria-label={t("scoreFor", { team: names[f.home_team_id!] ?? "" })} />
                          <Input type="number" name="away_score" min={0} max={99} required defaultValue={f.away_score ?? undefined} aria-label={t("scoreFor", { team: names[f.away_team_id!] ?? "" })} />
                          {f.stage === "knockout" ? (
                            <>
                              <Input type="number" name="home_penalties" min={0} max={99} placeholder={t("pens")} aria-label={t("pensFor", { team: names[f.home_team_id!] ?? "" })} />
                              <Input type="number" name="away_penalties" min={0} max={99} placeholder={t("pens")} aria-label={t("pensFor", { team: names[f.away_team_id!] ?? "" })} />
                            </>
                          ) : null}
                        </div>
                        <SubmitButton size="sm">{t("save")}</SubmitButton>
                      </ActionForm>
                      {isOrganizer && f.result_status === "submitted" ? (
                        <ActionForm action={confirmTournamentResultAction} className="mt-2">
                          <Hidden values={{ match_id: f.id, tournament_id: tournamentId }} />
                          <SubmitButton size="sm" variant="secondary">{t("confirmSubmitted")}</SubmitButton>
                        </ActionForm>
                      ) : null}
                      {isOrganizer ? (
                        <ActionForm action={scheduleFixtureAction} className="mt-2">
                          <Hidden values={{ match_id: f.id, tournament_id: tournamentId }} />
                          <div className="grid grid-cols-2 gap-2">
                            <Input type="datetime-local" name="scheduled_at" defaultValue={f.scheduled_at ? toLocalInputValue(f.scheduled_at, tz) : undefined} aria-label={t("scheduledAt")} dir="ltr" />
                            <Input name="location_note" defaultValue={f.location_note ?? ""} maxLength={200} placeholder={t("location")} aria-label={t("location")} />
                          </div>
                          <SubmitButton size="sm" variant="ghost">{t("saveSchedule")}</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </details>
                  ) : null}
                  {canDispute ? (
                    <div className="flex justify-center">
                      <ConfirmAction
                        action={disputeTournamentResultAction}
                        values={{ match_id: f.id, tournament_id: tournamentId }}
                        label={t("dispute")}
                        title={t("dispute")}
                        confirmLabel={t("dispute")}
                        reasonName="reason"
                        reasonLabel={t("disputeReason")}
                        reasonRequired
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
