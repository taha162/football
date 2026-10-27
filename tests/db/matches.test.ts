import { describe, expect, it } from "vitest";
import { MATCH_STATUSES, MATCH_TRANSITIONS } from "@/lib/domain/match";
import {
  admin,
  createMatch,
  createUser,
  createUsers,
  errorOf,
  getMatch,
  moveMatchToPast,
  notificationsOf,
  rpc,
  asUser,
} from "./helpers";

type JoinResult = { result: "joined" | "pending" | "waitlisted" | "full"; waitlist_position?: number };

describe("match capacity under concurrency", () => {
  it("never exceeds capacity when many users join the same match simultaneously", async () => {
    const organizer = await createUser("Org");
    // 10-player roster, 5 reserved offline -> 5 platform slots.
    const match = await createMatch(organizer, { total: 10, reserved: 5 });
    const players = await createUsers(20);

    const results = await Promise.allSettled(players.map((p) => rpc<JoinResult>(p, "join_match", { p_match_id: match })));

    const joined = results.filter((r) => r.status === "fulfilled" && r.value.result === "joined");
    const full = results.filter((r) => r.status === "fulfilled" && r.value.result === "full");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toEqual([]);
    expect(joined).toHaveLength(5);
    expect(full).toHaveLength(15);

    const m = await getMatch(match);
    expect(m.confirmed_count).toBe(5);
    expect(m.status).toBe("full");
    const [{ count }] = await admin<{ count: string }>(
      "select count(*) from public.match_participants where match_id = $1 and status = 'confirmed'",
      [match],
    );
    expect(Number(count)).toBe(5);
  });

  it("orders the waiting list deterministically when the last slots are contested", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 4, reserved: 1 });
    const players = await createUsers(10);

    const results = await Promise.all(
      players.map((p) => rpc<JoinResult>(p, "join_match", { p_match_id: match, p_waitlist_if_full: true })),
    );
    expect(results.filter((r) => r.result === "joined")).toHaveLength(3);
    const waitlisted = results.filter((r) => r.result === "waitlisted");
    expect(waitlisted).toHaveLength(7);
    expect(waitlisted.map((r) => r.waitlist_position).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const m = await getMatch(match);
    expect(m.confirmed_count).toBe(3);
    expect(m.waitlist_count).toBe(7);
  });

  it("rejects duplicate registration, including two simultaneous attempts by the same user", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    const player = await createUser();

    const results = await Promise.allSettled([
      rpc<JoinResult>(player, "join_match", { p_match_id: match }),
      rpc<JoinResult>(player, "join_match", { p_match_id: match }),
      rpc<JoinResult>(player, "join_match", { p_match_id: match }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) expect((f.reason as Error).message).toBe("already_joined");
    expect((await getMatch(match)).confirmed_count).toBe(1);
  });

  it("promotes the first waiting player when a participant leaves a full match", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 2 });
    const [a, b, w1, w2] = await createUsers(4);
    await rpc(a, "join_match", { p_match_id: match });
    await rpc(b, "join_match", { p_match_id: match });
    expect((await rpc<JoinResult>(w1, "join_match", { p_match_id: match, p_waitlist_if_full: true })).result).toBe("waitlisted");
    expect((await rpc<JoinResult>(w2, "join_match", { p_match_id: match, p_waitlist_if_full: true })).result).toBe("waitlisted");
    expect((await getMatch(match)).status).toBe("full");

    const left = await rpc<{ result: string; promoted: number }>(a, "leave_match", { p_match_id: match });
    expect(left).toMatchObject({ result: "left", promoted: 1 });

    const roster = await admin<{ user_id: string; promoted_from_waitlist: boolean }>(
      "select user_id, promoted_from_waitlist from public.match_participants where match_id = $1 and status = 'confirmed'",
      [match],
    );
    expect(roster.map((r) => r.user_id).sort()).toEqual([b, w1].sort());
    expect(roster.find((r) => r.user_id === w1)?.promoted_from_waitlist).toBe(true);
    const m = await getMatch(match);
    expect(m).toMatchObject({ status: "full", confirmed_count: 2, waitlist_count: 1 });
    expect(await notificationsOf(w1, "waitlist_promoted")).toHaveLength(1);
    expect(await notificationsOf(organizer, "match_participant_left")).toHaveLength(1);
  });

  it("re-opens the match when a slot frees up and nobody is waiting", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 2 });
    const [a, b] = await createUsers(2);
    await rpc(a, "join_match", { p_match_id: match });
    await rpc(b, "join_match", { p_match_id: match });
    expect((await getMatch(match)).status).toBe("full");
    await rpc(b, "leave_match", { p_match_id: match });
    expect(await getMatch(match)).toMatchObject({ status: "open", confirmed_count: 1 });
  });

  it("handles simultaneous leave and join without overflowing", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 3 });
    const members = await createUsers(3);
    for (const m of members) await rpc(m, "join_match", { p_match_id: match });
    const newcomers = await createUsers(6);
    await Promise.allSettled([
      rpc(members[0], "leave_match", { p_match_id: match }),
      ...newcomers.map((n) => rpc(n, "join_match", { p_match_id: match, p_waitlist_if_full: true })),
    ]);
    const m = await getMatch(match);
    expect(m.confirmed_count).toBe(3);
    expect(m.waitlist_count).toBe(5);
  });

  it("flags late withdrawals after the leave deadline", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { days: 0.5, extra: { p_leave_deadline_hours: 72 } });
    const p = await createUser();
    await rpc(p, "join_match", { p_match_id: match });
    const res = await rpc<{ late_withdrawal: boolean }>(p, "leave_match", { p_match_id: match });
    expect(res.late_withdrawal).toBe(true);
  });
});

describe("match lifecycle rules", () => {
  it("does not allow joining cancelled, completed or draft matches", async () => {
    const organizer = await createUser("Org");
    const player = await createUser();

    const cancelled = await createMatch(organizer);
    await rpc(organizer, "cancel_match", { p_match_id: cancelled, p_reason: "rain" });
    expect(await errorOf(rpc(player, "join_match", { p_match_id: cancelled }))).toBe("match_not_joinable");

    const draft = await createMatch(organizer, { publish: false });
    expect(await errorOf(rpc(player, "join_match", { p_match_id: draft }))).toBe("match_not_found");

    const done = await createMatch(organizer);
    await moveMatchToPast(done);
    await rpc(organizer, "complete_match", { p_match_id: done });
    expect(await errorOf(rpc(player, "join_match", { p_match_id: done }))).toBe("match_not_joinable");
  });

  it("notifies participants and waiting players when a match is cancelled", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 2 });
    const [a, b, w] = await createUsers(3);
    await rpc(a, "join_match", { p_match_id: match });
    await rpc(b, "join_match", { p_match_id: match });
    await rpc(w, "join_match", { p_match_id: match, p_waitlist_if_full: true });
    await rpc(organizer, "cancel_match", { p_match_id: match, p_reason: "Field closed" });
    for (const u of [a, b, w]) expect(await notificationsOf(u, "match_cancelled")).toHaveLength(1);
    const [conv] = await admin<{ is_locked: boolean }>("select is_locked from public.conversations where match_id = $1", [match]);
    expect(conv.is_locked).toBe(true);
    // Retrying the cancellation does not duplicate anything.
    expect(await errorOf(rpc(organizer, "cancel_match", { p_match_id: match }))).toBe("invalid_status_transition");
  });

  it("enforces status transitions at the database level, for every code path", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    await rpc(organizer, "cancel_match", { p_match_id: match });
    // Even a superuser update cannot resurrect a cancelled match.
    expect(await errorOf(admin("update public.matches set status = 'open' where id = $1", [match]))).toBe(
      "invalid_status_transition",
    );
  });

  it("keeps the TypeScript transition table identical to the database", async () => {
    for (const from of MATCH_STATUSES) {
      for (const to of MATCH_STATUSES) {
        const [{ allowed }] = await admin<{ allowed: boolean }>(
          "select public.match_transition_allowed($1::public.match_status, $2::public.match_status) as allowed",
          [from, to],
        );
        expect({ from, to, allowed }).toEqual({ from, to, allowed: from === to || MATCH_TRANSITIONS[from].includes(to) });
      }
    }
  });

  it("refuses to shrink capacity below the confirmed roster", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 4 });
    const players = await createUsers(3);
    for (const p of players) await rpc(p, "join_match", { p_match_id: match });
    const [m] = await admin<{ title: string }>("select title from public.matches where id = $1", [match]);
    const err = await errorOf(
      rpc(organizer, "update_match", {
        p_match_id: match,
        p_title: m.title,
        p_start_local: "2099-01-01 20:00",
        p_duration_minutes: 90,
        p_total_players: 2,
      }),
    );
    expect(err).toBe("capacity_below_participants");
  });

  it("only the organizer can cancel, edit or remove participants", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    const [player, stranger] = await createUsers(2);
    const { participant_id } = await rpc<{ participant_id: string }>(player, "join_match", { p_match_id: match });
    expect(await errorOf(rpc(stranger, "cancel_match", { p_match_id: match }))).toBe("forbidden");
    expect(await errorOf(rpc(stranger, "remove_match_participant", { p_participant_id: participant_id }))).toBe("forbidden");
    expect(await errorOf(rpc(player, "confirm_match", { p_match_id: match }))).toBe("match_not_found");
    await rpc(organizer, "remove_match_participant", { p_participant_id: participant_id, p_reason: "test" });
    expect(await notificationsOf(player, "participant_removed")).toHaveLength(1);
  });
});

describe("participation policies", () => {
  it("approval matches hold requests as pending without consuming slots", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 2, joinPolicy: "approval" });
    const [a, b, c] = await createUsers(3);
    const ra = await rpc<{ result: string; participant_id: string }>(a, "join_match", { p_match_id: match });
    const rb = await rpc<{ result: string; participant_id: string }>(b, "join_match", { p_match_id: match });
    const rc = await rpc<{ result: string; participant_id: string }>(c, "join_match", { p_match_id: match });
    expect([ra.result, rb.result, rc.result]).toEqual(["pending", "pending", "pending"]);
    expect(await getMatch(match)).toMatchObject({ confirmed_count: 0, pending_count: 3 });

    await rpc(organizer, "decide_match_participant", { p_participant_id: ra.participant_id, p_approve: true });
    await rpc(organizer, "decide_match_participant", { p_participant_id: rb.participant_id, p_approve: true });
    expect(
      await errorOf(rpc(organizer, "decide_match_participant", { p_participant_id: rc.participant_id, p_approve: true })),
    ).toBe("match_full");
    await rpc(organizer, "decide_match_participant", { p_participant_id: rc.participant_id, p_approve: false });
    expect(await notificationsOf(c, "match_registration_rejected")).toHaveLength(1);
    expect(await getMatch(match)).toMatchObject({ status: "full", confirmed_count: 2, pending_count: 0 });
  });

  it("private matches require an invitation; accepting it registers the player", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { type: "private" });
    const [invited, outsider] = await createUsers(2);

    // Outsiders cannot even see the match.
    expect(await asUser(outsider, "select id from public.matches where id = $1", [match])).toEqual([]);
    expect(await errorOf(rpc(outsider, "join_match", { p_match_id: match }))).toBe("match_not_found");

    const invitation = await rpc<string>(organizer, "invite_to_match", { p_match_id: match, p_user_id: invited });
    expect(await asUser(invited, "select id from public.matches where id = $1", [match])).toHaveLength(1);
    expect(await errorOf(rpc(organizer, "invite_to_match", { p_match_id: match, p_user_id: invited }))).toBe("already_invited");
    const res = await rpc<{ result: string }>(invited, "respond_match_invitation", { p_invitation_id: invitation, p_accept: true });
    expect(res.result).toBe("joined");
    expect(await errorOf(rpc(invited, "respond_match_invitation", { p_invitation_id: invitation, p_accept: true }))).toBe(
      "invitation_not_pending",
    );
  });

  it("blocked users cannot join the blocker's matches", async () => {
    const organizer = await createUser("Org");
    const troll = await createUser();
    await rpc(organizer, "block_user", { p_user_id: troll });
    const match = await createMatch(organizer);
    expect(await errorOf(rpc(troll, "join_match", { p_match_id: match }))).toBe("user_blocked");
  });

  it("suspended or not-onboarded users cannot join", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    const fresh = await createUser("New", { onboard: false });
    expect(await errorOf(rpc(fresh, "join_match", { p_match_id: match }))).toBe("profile_incomplete");
    const suspended = await createUser();
    await admin("update public.profiles set status = 'suspended' where id = $1", [suspended]);
    expect(await errorOf(rpc(suspended, "join_match", { p_match_id: match }))).toBe("account_suspended");
  });

  it("computes the per-player cost share with integer ceiling division", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer, { total: 10, extra: { p_total_cost: 50_001, p_paying_players: 10 } });
    const [m] = await admin<{ price_per_player: string; currency: string }>(
      "select price_per_player, currency from public.matches where id = $1",
      [match],
    );
    expect(Number(m.price_per_player)).toBe(5_001);
    expect(m.currency).toBe("IQD");
  });

  it("creates weekly recurring occurrences as separate matches in one series", async () => {
    const organizer = await createUser("Org");
    const first = await createMatch(organizer, { extra: { p_repeat_weeks: 3 } });
    const rows = await admin<{ starts_at: Date }>(
      "select starts_at from public.matches where series_id = (select series_id from public.matches where id = $1) order by starts_at",
      [first],
    );
    expect(rows).toHaveLength(4);
    expect(rows[1].starts_at.getTime() - rows[0].starts_at.getTime()).toBe(7 * 86_400_000);
  });
});

describe("discovery", () => {
  it("filters server-side and hides private, draft and hidden matches", async () => {
    const organizer = await createUser("Org");
    const viewer = await createUser();
    const tag = `F${Date.now()}`;
    const visible = await createMatch(organizer, { extra: { p_title: `${tag} public`, p_total_cost: 20_000 } });
    await createMatch(organizer, { type: "private", extra: { p_title: `${tag} private` } });
    await createMatch(organizer, { publish: false, extra: { p_title: `${tag} draft` } });
    const rows = await asUser<{ id: string; title: string }>(
      viewer,
      "select id, title from public.search_matches(p_limit => 100) where title like $1",
      [`${tag}%`],
    );
    expect(rows.map((r) => r.id)).toEqual([visible]);

    const cheap = await asUser<{ id: string }>(
      null,
      "select id from public.search_matches(p_max_price => 1000, p_limit => 100) where title like $1",
      [`${tag}%`],
    );
    expect(cheap).toEqual([]);
  });
});
