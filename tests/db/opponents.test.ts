import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, localTime, mosul, notificationsOf, rpc } from "./helpers";

async function teamWithCaptain(name: string) {
  const captain = await createUser(name);
  const team = await rpc<string>(captain, "create_team", { p_name: `${name} ${captain.slice(0, 5)}`, p_city_id: await mosul(), p_preferred_format: "5v5" });
  return { captain, team };
}

describe("opponent matchmaking", () => {
  it("two teams arrange a match: request, challenge, accept", async () => {
    const home = await teamWithCaptain("Home");
    const away = await teamWithCaptain("Away");
    const third = await teamWithCaptain("Third");
    const request = await rpc<string>(home.captain, "create_opponent_request", {
      p_team_id: home.team,
      p_earliest_local: localTime(2, 16),
      p_latest_local: localTime(5, 23),
      p_format: "5v5",
      p_cost_per_team: 25_000,
    });
    const c1 = await rpc<string>(away.captain, "send_challenge", {
      p_challenger_team_id: away.team,
      p_request_id: request,
      p_start_local: localTime(3, 20),
      p_duration_minutes: 60,
      p_message: "Thursday night?",
    });
    const c2 = await rpc<string>(third.captain, "send_challenge", {
      p_challenger_team_id: third.team,
      p_request_id: request,
      p_start_local: localTime(4, 20),
      p_duration_minutes: 60,
    });
    expect(await notificationsOf(home.captain, "challenge_received")).toHaveLength(2);

    // Negotiation channel is visible to both captains but not to others.
    const conv = await rpc<string>(away.captain, "entity_conversation_id", { p_kind: "challenge", p_entity_id: c1 });
    await rpc(away.captain, "send_message", { p_conversation_id: conv, p_body: "We can bring the ball" });
    expect(await asUser(home.captain, "select body from public.messages where conversation_id = $1", [conv])).toHaveLength(1);
    expect(await asUser(third.captain, "select body from public.messages where conversation_id = $1", [conv])).toEqual([]);

    const match = await rpc<string>(home.captain, "respond_challenge", { p_challenge_id: c1, p_accept: true });
    const [m] = await admin<Record<string, unknown>>("select * from public.matches where id = $1", [match]);
    expect(m).toMatchObject({ match_type: "team_vs_team", home_team_id: home.team, away_team_id: away.team, total_players: 10 });
    expect(Number(m.price_per_player)).toBe(5_000);

    const [c2row] = await admin<{ status: string }>("select status from public.opponent_challenges where id = $1", [c2]);
    expect(c2row.status).toBe("expired");
    expect(await errorOf(rpc(home.captain, "respond_challenge", { p_challenge_id: c2, p_accept: true }))).toBe("challenge_not_pending");
    expect(await notificationsOf(away.captain, "challenge_accepted")).toHaveLength(1);

    // Both teams' members see the fixture; only they may join, each on their own side.
    expect(await asUser(away.captain, "select id from public.matches where id = $1", [match])).toHaveLength(1);
    const res = await rpc<{ result: string }>(away.captain, "join_match", { p_match_id: match });
    expect(res.result).toBe("joined");
    const [side] = await admin<{ team_side: string }>("select team_side from public.match_participants where match_id = $1 and user_id = $2", [match, away.captain]);
    expect(side.team_side).toBe("away");
    expect(await errorOf(rpc(third.captain, "join_match", { p_match_id: match }))).toBe("match_not_found");
  });

  it("only one challenge can be accepted for a request, even concurrently", async () => {
    const home = await teamWithCaptain("Home");
    const request = await rpc<string>(home.captain, "create_opponent_request", {
      p_team_id: home.team,
      p_earliest_local: localTime(2, 16),
      p_latest_local: localTime(5, 23),
      p_format: "5v5",
    });
    const challenges = await Promise.all(
      [1, 2, 3, 4].map(async (i) => {
        const t = await teamWithCaptain(`C${i}`);
        return rpc<string>(t.captain, "send_challenge", {
          p_challenger_team_id: t.team,
          p_request_id: request,
          p_start_local: localTime(3, 17 + i),
          p_duration_minutes: 60,
        });
      }),
    );
    const results = await Promise.allSettled(
      challenges.map((c) => rpc(home.captain, "respond_challenge", { p_challenge_id: c, p_accept: true })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [{ count }] = await admin<{ count: string }>("select count(*) from public.matches where home_team_id = $1", [home.team]);
    expect(Number(count)).toBe(1);
  });

  it("non-managers cannot publish requests or respond to challenges", async () => {
    const home = await teamWithCaptain("Home");
    const away = await teamWithCaptain("Away");
    const member = await createUser();
    expect(
      await errorOf(
        rpc(member, "create_opponent_request", {
          p_team_id: home.team,
          p_earliest_local: localTime(2),
          p_latest_local: localTime(3),
          p_format: "5v5",
        }),
      ),
    ).toBe("forbidden");
    const c = await rpc<string>(away.captain, "send_challenge", {
      p_challenger_team_id: away.team,
      p_target_team_id: home.team,
      p_start_local: localTime(3, 20),
      p_duration_minutes: 60,
    });
    expect(await errorOf(rpc(away.captain, "respond_challenge", { p_challenge_id: c, p_accept: true }))).toBe("challenge_not_found");
    expect(await errorOf(rpc(away.captain, "send_challenge", {
      p_challenger_team_id: away.team,
      p_target_team_id: home.team,
      p_start_local: localTime(3, 20),
      p_duration_minutes: 60,
    }))).toBe("already_challenged");
  });
});
