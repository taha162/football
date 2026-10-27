import { describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, errorOf, mosul, moveMatchToPast, notificationsOf, rpc } from "./helpers";

async function completedMatchWith(players: number) {
  const organizer = await createUser("Org");
  const match = await createMatch(organizer, { organizerPlays: true });
  const ps: string[] = [];
  for (let i = 0; i < players; i++) {
    const p = await createUser();
    await rpc(p, "join_match", { p_match_id: match });
    ps.push(p);
  }
  await moveMatchToPast(match);
  await rpc(organizer, "report_match_result", { p_match_id: match, p_home_score: 3, p_away_score: 2 });
  return { organizer, match, players: ps };
}

describe("results and statistics", () => {
  it("reporting a result completes the match; events feed player statistics", async () => {
    const { organizer, match, players } = await completedMatchWith(2);
    const [m] = await admin<{ status: string }>("select status from public.matches where id = $1", [match]);
    expect(m.status).toBe("completed");
    await rpc(organizer, "set_match_events", {
      p_match_id: match,
      p_events: [
        { user_id: players[0], event_type: "goal", minute: 10 },
        { user_id: players[0], event_type: "goal", minute: 30 },
        { user_id: players[1], event_type: "assist", minute: 30 },
      ],
    });
    const stats = await rpc<Record<string, number>>(null, "player_stats", { p_user_id: players[0] });
    expect(stats).toMatchObject({ matches_played: 1, goals: 2, assists: 0 });
    const outsider = await createUser();
    expect(
      await errorOf(rpc(organizer, "set_match_events", { p_match_id: match, p_events: [{ user_id: outsider, event_type: "goal" }] })),
    ).toBe("event_player_not_participant");
    expect(await errorOf(rpc(players[0], "set_match_events", { p_match_id: match, p_events: [] }))).toBe("forbidden");
  });

  it("hides statistics of players who opted out of public history", async () => {
    const { players } = await completedMatchWith(1);
    await rpc(players[0], "update_my_profile", {
      p_display_name: "Private Person",
      p_city_id: await mosul(),
      p_show_match_history: false,
    });
    expect(await rpc(null, "player_stats", { p_user_id: players[0] })).toBeNull();
    expect(await rpc(players[0], "player_stats", { p_user_id: players[0] })).not.toBeNull();
  });
});

describe("reviews", () => {
  it("only participants of a completed match may review each other, once", async () => {
    const { organizer, match, players } = await completedMatchWith(2);
    const outsider = await createUser();
    const args = { p_match_id: match, p_subject_user_id: players[1], p_reliability: 5, p_punctuality: 4, p_sportsmanship: 5 };
    await rpc(players[0], "submit_player_review", args);
    expect(await errorOf(rpc(players[0], "submit_player_review", args))).toBe("already_reviewed");
    expect(await errorOf(rpc(outsider, "submit_player_review", args))).toBe("review_not_eligible");
    expect(await errorOf(rpc(players[1], "submit_player_review", { ...args, p_subject_user_id: players[1] }))).toBe("cannot_review_self");
    expect(
      await errorOf(rpc(players[1], "submit_player_review", { ...args, p_subject_user_id: players[0], p_organization: 5 })),
    ).toBe("organization_rating_not_applicable");
    await rpc(players[1], "submit_player_review", { ...args, p_subject_user_id: organizer, p_organization: 5 });
    expect(await notificationsOf(players[1], "review_received")).toHaveLength(1);
    // Player review comments are private to reviewer/subject; aggregates hidden below threshold.
    expect(await asUser(outsider, "select * from public.reviews where subject_user_id = $1", [players[1]])).toEqual([]);
    expect(await rpc(null, "player_reputation", { p_user_id: players[1] })).toEqual({ count: 1, visible: false });
  });

  it("no-shows cannot review and cannot be reviewed", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { organizerPlays: true });
    const [p1, p2] = [await createUser(), await createUser()];
    const { participant_id } = await rpc<{ participant_id: string }>(p1, "join_match", { p_match_id: match });
    await rpc(p2, "join_match", { p_match_id: match });
    await moveMatchToPast(match);
    await rpc(organizer, "set_participant_details", { p_participant_id: participant_id, p_attendance: "no_show" });
    await rpc(organizer, "complete_match", { p_match_id: match });
    const base = { p_match_id: match, p_reliability: 1, p_punctuality: 1, p_sportsmanship: 3 };
    expect(await errorOf(rpc(p1, "submit_player_review", { ...base, p_subject_user_id: p2 }))).toBe("review_not_eligible");
    expect(await errorOf(rpc(p2, "submit_player_review", { ...base, p_subject_user_id: p1 }))).toBe("review_not_eligible");
  });
});

describe("reports and moderation", () => {
  it("snapshots a reported message for moderators and lets them resolve it", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const messageId = await rpc<string>(a, "send_message", { p_conversation_id: conv, p_body: "abusive text" });
    const outsider = await createUser();
    expect(await errorOf(rpc(outsider, "create_report", { p_target_type: "message", p_target_id: String(messageId), p_category: "harassment" }))).toBe(
      "report_target_not_found",
    );
    const report = await rpc<string>(b, "create_report", {
      p_target_type: "message",
      p_target_id: String(messageId),
      p_category: "harassment",
      p_details: "Insulting me",
    });
    expect(await errorOf(rpc(b, "create_report", { p_target_type: "message", p_target_id: String(messageId), p_category: "harassment" }))).toBe(
      "already_reported",
    );
    const moderator = await createUser("Admin", { admin: true });
    const [row] = await asUser<{ snapshot: { body: string } }>(moderator, "select snapshot from public.reports where id = $1", [report]);
    expect(row.snapshot.body).toBe("abusive text");
    // Moderators still cannot read the conversation itself.
    expect(await asUser(moderator, "select * from public.messages where conversation_id = $1", [conv])).toEqual([]);
    await rpc(moderator, "admin_set_user_status", { p_user_id: a, p_status: "suspended", p_reason: "harassment" });
    await rpc(moderator, "admin_update_report", { p_report_id: report, p_status: "resolved", p_note: "User suspended" });
    expect(await errorOf(rpc(b, "admin_update_report", { p_report_id: report, p_status: "dismissed" }))).toBe("forbidden");
  });

  it("hiding a match removes it from public view and notifies the organizer", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    const moderator = await createUser("Admin", { admin: true });
    expect(await errorOf(rpc(moderator, "admin_set_hidden", { p_entity_type: "match", p_entity_id: match, p_hidden: true }))).toBe(
      "reason_required",
    );
    await rpc(moderator, "admin_set_hidden", { p_entity_type: "match", p_entity_id: match, p_hidden: true, p_reason: "fake listing" });
    expect(await asUser(null, "select id from public.matches where id = $1", [match])).toEqual([]);
    expect(await asUser(organizer, "select id from public.matches where id = $1", [match])).toHaveLength(1);
    expect(await notificationsOf(organizer, "moderation_notice")).toHaveLength(1);
  });
});

describe("scheduled jobs", () => {
  it("sends reminders once and auto-completes stale matches idempotently", async () => {
    const organizer = await createUser("Org");
    const soon = await createMatch(organizer, { days: 0.5 });
    const p = await createUser();
    await rpc(p, "join_match", { p_match_id: soon });
    const stale = await createMatch(organizer);
    await moveMatchToPast(stale, 10);
    await admin("select public.run_scheduled_jobs()");
    await admin("select public.run_scheduled_jobs()");
    expect(await notificationsOf(p, "match_reminder")).toHaveLength(1);
    const [m] = await admin<{ status: string }>("select status from public.matches where id = $1", [stale]);
    expect(m.status).toBe("completed");
  });
});
