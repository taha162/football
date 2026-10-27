import { describe, expect, it } from "vitest";
import { assignGroups, computeStandings, groupStage, knockoutFromGroups, singleElimination } from "@/lib/domain/tournament";
import { admin, createUser, errorOf, localTime, mosul, notificationsOf, rpc } from "./helpers";

async function setupTournament(capacity: number, format: "round_robin" | "single_elimination" | "groups_knockout", groupCount = 1) {
  const organizer = await createUser("Org");
  const tournament = await rpc<string>(organizer, "upsert_tournament", {
    p_tournament_id: null,
    p_name: `Cup ${organizer.slice(0, 5)}`,
    p_city_id: await mosul(),
    p_format: "5v5",
    p_tournament_format: format,
    p_team_capacity: capacity,
    p_registration_deadline_local: localTime(5, 23),
    p_starts_on: localTime(7).slice(0, 10),
    p_ends_on: localTime(14).slice(0, 10),
    p_group_count: groupCount,
    p_min_team_size: 1,
  });
  await rpc(organizer, "set_tournament_status", { p_tournament_id: tournament, p_status: "registration_open" });
  return { organizer, tournament };
}

async function registerTeams(tournament: string, n: number) {
  const teams: { captain: string; team: string; registration: string }[] = [];
  for (let i = 0; i < n; i++) {
    const captain = await createUser(`Cap${i}`);
    const team = await rpc<string>(captain, "create_team", { p_name: `T${i} ${captain.slice(0, 4)}`, p_city_id: await mosul() });
    const registration = await rpc<string>(captain, "register_tournament_team", { p_tournament_id: tournament, p_team_id: team });
    teams.push({ captain, team, registration });
  }
  return teams;
}

async function fixtures(tournament: string) {
  return admin<{
    id: string; stage: string; round: number; home_team_id: string | null; away_team_id: string | null;
    status: string; winner_team_id: string | null; is_bye: boolean; home_score: number | null; away_score: number | null;
    result_status: "none" | "submitted" | "confirmed" | "disputed"; group_label: string | null;
  }>("select * from public.tournament_matches where tournament_id = $1 order by stage, round, match_number", [tournament]);
}

describe("tournaments", () => {
  it("registers teams, waitlists over capacity and promotes on withdrawal", async () => {
    const { organizer, tournament } = await setupTournament(2, "single_elimination");
    const teams = await registerTeams(tournament, 3);
    expect(await errorOf(rpc(teams[0].captain, "register_tournament_team", { p_tournament_id: tournament, p_team_id: teams[0].team }))).toBe(
      "already_registered",
    );
    const decisions = [];
    for (const t of teams) decisions.push(await rpc(organizer, "decide_tournament_registration", { p_registration_id: t.registration, p_approve: true }));
    expect(decisions).toEqual(["approved", "approved", "waitlisted"]);
    await rpc(teams[0].captain, "withdraw_tournament_team", { p_tournament_id: tournament, p_team_id: teams[0].team });
    const [row] = await admin<{ status: string }>("select status from public.tournament_teams where id = $1", [teams[2].registration]);
    expect(row.status).toBe("approved");
    expect(await errorOf(rpc(teams[1].captain, "decide_tournament_registration", { p_registration_id: teams[1].registration, p_approve: true }))).toBe(
      "forbidden",
    );
  });

  it("single elimination with 5 teams: byes advance, results advance winners, draws need penalties", async () => {
    const { organizer, tournament } = await setupTournament(8, "single_elimination");
    const teams = await registerTeams(tournament, 5);
    for (const t of teams) await rpc(organizer, "decide_tournament_registration", { p_registration_id: t.registration, p_approve: true });
    const plan = singleElimination(teams.map((t) => t.team));
    expect(await errorOf(rpc(organizer, "save_tournament_fixtures", { p_tournament_id: tournament, p_fixtures: plan }))).toBe(
      "registration_must_be_closed",
    );
    await rpc(organizer, "set_tournament_status", { p_tournament_id: tournament, p_status: "registration_closed" });
    expect(await rpc(organizer, "save_tournament_fixtures", { p_tournament_id: tournament, p_fixtures: plan })).toBe(7);
    expect(await errorOf(rpc(organizer, "save_tournament_fixtures", { p_tournament_id: tournament, p_fixtures: plan }))).toBe(
      "fixtures_already_generated",
    );

    let fx = await fixtures(tournament);
    const round1 = fx.filter((f) => f.round === 1);
    expect(round1.filter((f) => f.is_bye)).toHaveLength(3);
    // Top seeds 1,2,3 received byes and already occupy round-2 slots.
    const round2Teams = fx.filter((f) => f.round === 2).flatMap((f) => [f.home_team_id, f.away_team_id]);
    expect(round2Teams).toEqual(expect.arrayContaining([teams[0].team, teams[1].team, teams[2].team]));

    const real = round1.find((f) => !f.is_bye)!;
    expect(
      await errorOf(rpc(organizer, "record_tournament_result", { p_match_id: real.id, p_home_score: 1, p_away_score: 1 })),
    ).toBe("knockout_needs_winner");

    // A team manager submits; the organizer confirms.
    const homeCaptain = teams.find((t) => t.team === real.home_team_id)!.captain;
    expect(
      await rpc(homeCaptain, "record_tournament_result", {
        p_match_id: real.id, p_home_score: 2, p_away_score: 2, p_home_penalties: 4, p_away_penalties: 3,
      }),
    ).toBe("submitted");
    expect(await notificationsOf(organizer, "tournament_result_submitted")).toHaveLength(1);
    await rpc(organizer, "confirm_tournament_result", { p_match_id: real.id });
    fx = await fixtures(tournament);
    const semiWithWinner = fx.find((f) => f.round === 2 && (f.home_team_id === real.home_team_id || f.away_team_id === real.home_team_id));
    expect(semiWithWinner).toBeDefined();

    // Play out the bracket.
    for (const round of [2, 3]) {
      fx = await fixtures(tournament);
      for (const f of fx.filter((x) => x.round === round)) {
        await rpc(organizer, "record_tournament_result", { p_match_id: f.id, p_home_score: 3, p_away_score: 0 });
      }
    }
    fx = await fixtures(tournament);
    const final = fx.find((f) => f.round === 3)!;
    expect(final.status).toBe("completed");
    expect(final.winner_team_id).toBe(final.home_team_id);
    await rpc(organizer, "set_tournament_status", { p_tournament_id: tournament, p_status: "completed" });
  });

  it("round robin: generated fixtures are stored and standings computed from confirmed results", async () => {
    const { organizer, tournament } = await setupTournament(4, "round_robin");
    const teams = await registerTeams(tournament, 4);
    for (const t of teams) await rpc(organizer, "decide_tournament_registration", { p_registration_id: t.registration, p_approve: true });
    await rpc(organizer, "set_tournament_status", { p_tournament_id: tournament, p_status: "registration_closed" });
    const ids = teams.map((t) => t.team);
    const plan = groupStage(Object.fromEntries(ids.map((id) => [id, "A"])));
    expect(await rpc(organizer, "save_tournament_fixtures", { p_tournament_id: tournament, p_fixtures: plan })).toBe(6);

    // Tampered fixtures (unapproved team, duplicate pairing) are refused for other tournaments.
    const other = await setupTournament(4, "round_robin");
    const otherTeams = await registerTeams(other.tournament, 2);
    for (const t of otherTeams) await rpc(other.organizer, "decide_tournament_registration", { p_registration_id: t.registration, p_approve: true });
    await rpc(other.organizer, "set_tournament_status", { p_tournament_id: other.tournament, p_status: "registration_closed" });
    expect(await errorOf(rpc(other.organizer, "save_tournament_fixtures", { p_tournament_id: other.tournament, p_fixtures: plan }))).toBe(
      "team_not_approved",
    );
    const dup = [
      { key: "a", stage: "group", round: 1, match_number: 1, group_label: "A", home_team_id: otherTeams[0].team, away_team_id: otherTeams[1].team, next_key: null, next_slot: null },
      { key: "b", stage: "group", round: 2, match_number: 2, group_label: "A", home_team_id: otherTeams[1].team, away_team_id: otherTeams[0].team, next_key: null, next_slot: null },
    ];
    expect(await errorOf(rpc(other.organizer, "save_tournament_fixtures", { p_tournament_id: other.tournament, p_fixtures: dup }))).toBe(
      "duplicate_pairing",
    );

    let fx = await fixtures(tournament);
    // Team 0 wins all; everything else draws.
    for (const f of fx) {
      const t0Home = f.home_team_id === ids[0];
      const t0Away = f.away_team_id === ids[0];
      await rpc(organizer, "record_tournament_result", {
        p_match_id: f.id,
        p_home_score: t0Home ? 2 : t0Away ? 0 : 1,
        p_away_score: t0Away ? 2 : t0Home ? 0 : 1,
      });
    }
    fx = await fixtures(tournament);
    const table = computeStandings(ids, fx);
    expect(table[0]).toMatchObject({ teamId: ids[0], played: 3, won: 3, points: 9 });
    expect(table.slice(1).every((r) => r.points === 2)).toBe(true);
  });

  it("groups + knockout: knockout fixtures only after the group stage completes", async () => {
    const { organizer, tournament } = await setupTournament(8, "groups_knockout", 2);
    const teams = await registerTeams(tournament, 8);
    for (const t of teams) await rpc(organizer, "decide_tournament_registration", { p_registration_id: t.registration, p_approve: true });
    await rpc(organizer, "set_tournament_status", { p_tournament_id: tournament, p_status: "registration_closed" });
    const ids = teams.map((t) => t.team);
    const groups = assignGroups(ids, 2);
    await rpc(organizer, "save_tournament_fixtures", { p_tournament_id: tournament, p_fixtures: groupStage(groups), p_groups: groups });

    const byGroup = (fx: Awaited<ReturnType<typeof fixtures>>) => {
      const result: Record<string, ReturnType<typeof computeStandings>> = {};
      for (const label of ["A", "B"]) {
        const members = ids.filter((id) => groups[id] === label);
        result[label] = computeStandings(members, fx.filter((f) => f.group_label === label), undefined, ids);
      }
      return result;
    };
    let fx = await fixtures(tournament);
    expect(
      await errorOf(rpc(organizer, "save_tournament_fixtures", { p_tournament_id: tournament, p_fixtures: knockoutFromGroups(byGroup(fx), 2) })),
    ).toBe("group_stage_incomplete");
    for (const f of fx) {
      await rpc(organizer, "record_tournament_result", { p_match_id: f.id, p_home_score: 1, p_away_score: 0 });
    }
    fx = await fixtures(tournament);
    const ko = knockoutFromGroups(byGroup(fx), 2);
    expect(await rpc(organizer, "save_tournament_fixtures", { p_tournament_id: tournament, p_fixtures: ko })).toBe(3);
  });
});
