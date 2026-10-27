import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, localTime, mosul, notificationsOf, rpc } from "./helpers";

async function createTeam(captain: string, extra: Record<string, unknown> = {}) {
  return rpc<string>(captain, "create_team", { p_name: `FC ${captain.slice(0, 6)}`, p_city_id: await mosul(), ...extra });
}

describe("teams", () => {
  it("captain creates a team, invites a member who accepts, and publishes recruitment", async () => {
    const captain = await createUser("Cap");
    const player = await createUser();
    const team = await createTeam(captain);

    const invitation = await rpc<string>(captain, "invite_to_team", { p_team_id: team, p_user_id: player, p_message: "Join us" });
    expect(await notificationsOf(player, "team_invitation")).toHaveLength(1);
    await rpc(player, "respond_team_invitation", { p_invitation_id: invitation, p_accept: true });
    const members = await asUser<{ user_id: string; role: string }>(captain, "select user_id, role from public.team_members where team_id = $1", [team]);
    expect(members).toEqual(expect.arrayContaining([{ user_id: captain, role: "captain" }, { user_id: player, role: "player" }]));

    const recruitment = await rpc<string>(captain, "create_recruitment", {
      p_team_id: team,
      p_title: "Need a goalkeeper",
      p_positions: "{goalkeeper}",
      p_expires_in_days: 7,
    });
    const applicant = await createUser();
    const request = await rpc<string>(applicant, "request_to_join_team", { p_team_id: team, p_recruitment_id: recruitment, p_position: "goalkeeper" });
    expect(await notificationsOf(captain, "recruitment_response")).toHaveLength(1);
    await rpc(captain, "decide_join_request", { p_request_id: request, p_approve: true });
    expect(await notificationsOf(applicant, "team_membership_decision")).toHaveLength(1);
    await rpc(captain, "close_recruitment", { p_recruitment_id: recruitment });
    expect(await errorOf(rpc(await createUser(), "request_to_join_team", { p_team_id: team, p_recruitment_id: recruitment }))).toBe(
      "recruitment_closed",
    );
  });

  it("private teams are invisible and cannot be joined without authorization", async () => {
    const captain = await createUser("Cap");
    const team = await createTeam(captain, { p_visibility: "private", p_join_policy: "invite_only" });
    const outsider = await createUser();
    expect(await asUser(outsider, "select id from public.teams where id = $1", [team])).toEqual([]);
    expect(await asUser(null, "select id from public.teams where id = $1", [team])).toEqual([]);
    expect(await errorOf(rpc(outsider, "request_to_join_team", { p_team_id: team }))).toBe("team_not_accepting_requests");
  });

  it("only managers change membership; managers cannot remove other managers", async () => {
    const captain = await createUser("Cap");
    const team = await createTeam(captain);
    const [manager, player, outsider] = [await createUser(), await createUser(), await createUser()];
    for (const u of [manager, player]) {
      const r = await rpc<string>(u, "request_to_join_team", { p_team_id: team });
      await rpc(captain, "decide_join_request", { p_request_id: r, p_approve: true });
    }
    await rpc(captain, "set_team_member_role", { p_team_id: team, p_user_id: manager, p_role: "manager" });
    expect(await errorOf(rpc(outsider, "remove_team_member", { p_team_id: team, p_user_id: player }))).toBe("forbidden");
    expect(await errorOf(rpc(player, "invite_to_team", { p_team_id: team, p_user_id: outsider }))).toBe("forbidden");
    expect(await errorOf(rpc(manager, "set_team_member_role", { p_team_id: team, p_user_id: player, p_role: "manager" }))).toBe("forbidden");
    const other = await createUser();
    const r = await rpc<string>(other, "request_to_join_team", { p_team_id: team });
    await rpc(manager, "decide_join_request", { p_request_id: r, p_approve: true });
    await rpc(captain, "set_team_member_role", { p_team_id: team, p_user_id: other, p_role: "manager" });
    expect(await errorOf(rpc(manager, "remove_team_member", { p_team_id: team, p_user_id: other }))).toBe("forbidden");
    await rpc(manager, "remove_team_member", { p_team_id: team, p_user_id: player });
    expect(await notificationsOf(player, "team_member_removed")).toHaveLength(1);
  });

  it("the captain must hand over captaincy before leaving; transfer demotes the old captain", async () => {
    const captain = await createUser("Cap");
    const team = await createTeam(captain);
    const player = await createUser();
    const r = await rpc<string>(player, "request_to_join_team", { p_team_id: team });
    await rpc(captain, "decide_join_request", { p_request_id: r, p_approve: true });
    expect(await errorOf(rpc(captain, "leave_team", { p_team_id: team }))).toBe("transfer_captaincy_first");
    await rpc(captain, "set_team_member_role", { p_team_id: team, p_user_id: player, p_role: "captain" });
    const roles = await admin<{ user_id: string; role: string }>("select user_id, role from public.team_members where team_id = $1", [team]);
    expect(roles).toEqual(expect.arrayContaining([{ user_id: captain, role: "manager" }, { user_id: player, role: "captain" }]));
    await rpc(captain, "leave_team", { p_team_id: team });
  });

  it("duplicate join requests and invitations are rejected", async () => {
    const captain = await createUser("Cap");
    const team = await createTeam(captain);
    const player = await createUser();
    await rpc(player, "request_to_join_team", { p_team_id: team });
    expect(await errorOf(rpc(player, "request_to_join_team", { p_team_id: team }))).toBe("already_requested");
    const invitee = await createUser();
    await rpc(captain, "invite_to_team", { p_team_id: team, p_user_id: invitee });
    expect(await errorOf(rpc(captain, "invite_to_team", { p_team_id: team, p_user_id: invitee }))).toBe("already_invited");
  });

  it("team-needs-players matches can only be created by the team's managers", async () => {
    const captain = await createUser("Cap");
    const team = await createTeam(captain);
    const outsider = await createUser();
    const args = {
      p_title: "Need 2 players",
      p_city_id: await mosul(),
      p_start_local: localTime(2),
      p_duration_minutes: 60,
      p_format: "5v5",
      p_total_players: 10,
      p_reserved_spots: 8,
      p_match_type: "team_needs_players",
      p_team_id: team,
    };
    expect(await errorOf(rpc(outsider, "create_match", args))).toBe("forbidden");
    expect(await rpc<string>(captain, "create_match", args)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
