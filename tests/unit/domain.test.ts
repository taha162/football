import { describe, expect, it } from "vitest";
import { availability, canTransition, defaultRosterSize, isLateWithdrawal, openSlots } from "@/lib/domain/match";
import { costSurplus, formatMoney, parseMoneyInput, priceForDuration, splitCost, toAsciiDigits } from "@/lib/domain/money";
import {
  assignGroups,
  bracketSeedOrder,
  computeStandings,
  groupStage,
  knockoutFromGroups,
  roundName,
  roundRobin,
  singleElimination,
  type ResultInput,
} from "@/lib/domain/tournament";

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe("cost sharing", () => {
  it("splits with ceiling division so the collector is never short", () => {
    expect(splitCost(50_000, 10)).toBe(5_000);
    expect(splitCost(50_001, 10)).toBe(5_001);
    expect(costSurplus(50_001, 10)).toBe(9);
    expect(splitCost(0, 10)).toBe(0);
    expect(splitCost(null, 10)).toBeNull();
    expect(splitCost(1000, 0)).toBeNull();
  });

  it("rejects non-integer amounts", () => {
    expect(() => splitCost(10.5, 2)).toThrow(RangeError);
    expect(() => splitCost(-1, 2)).toThrow(RangeError);
  });

  it("prices booking durations with round-half-up integer arithmetic", () => {
    expect(priceForDuration(30_000, 90)).toBe(45_000);
    expect(priceForDuration(25_001, 30)).toBe(12_501);
    expect(priceForDuration(1, 30)).toBe(1);
  });

  it("formats IQD without decimals in both locales", () => {
    expect(formatMoney(25_000, "IQD", "en")).toMatch(/25,000/);
    expect(formatMoney(25_000, "IQD", "ar")).toMatch(/٢٥/);
    expect(formatMoney(1234, "USD", "en")).toMatch(/12\.34/);
  });

  it("parses user input including Arabic-Indic digits", () => {
    expect(parseMoneyInput("25,000", "IQD")).toBe(25_000);
    expect(parseMoneyInput("٢٥٠٠٠", "IQD")).toBe(25_000);
    expect(parseMoneyInput("12.5", "IQD")).toBeNull();
    expect(parseMoneyInput("12.34", "USD")).toBe(1234);
    expect(parseMoneyInput("abc", "IQD")).toBeNull();
    expect(toAsciiDigits("۱۲٣")).toBe("123");
  });
});

describe("match rules", () => {
  it("computes open slots including reserved spots", () => {
    expect(openSlots({ total_players: 10, reserved_spots: 4, confirmed_count: 3 })).toBe(3);
    expect(openSlots({ total_players: 10, reserved_spots: 4, confirmed_count: 8 })).toBe(0);
    expect(defaultRosterSize("7v7")).toBe(14);
  });

  it("derives availability states", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(availability({ total_players: 10, reserved_spots: 0, confirmed_count: 2, status: "open", starts_at: future })).toBe("available");
    expect(availability({ total_players: 10, reserved_spots: 0, confirmed_count: 9, status: "open", starts_at: future })).toBe("almost_full");
    expect(availability({ total_players: 10, reserved_spots: 0, confirmed_count: 10, status: "full", starts_at: future })).toBe("full");
    expect(availability({ total_players: 10, reserved_spots: 0, confirmed_count: 2, status: "cancelled", starts_at: future })).toBe("closed");
  });

  it("allows only defined status transitions", () => {
    expect(canTransition("draft", "open")).toBe(true);
    expect(canTransition("open", "full")).toBe(true);
    expect(canTransition("full", "open")).toBe(true);
    expect(canTransition("completed", "open")).toBe(false);
    expect(canTransition("cancelled", "open")).toBe(false);
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("confirmed", "full")).toBe(false);
  });

  it("detects late withdrawals relative to the leave deadline", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isLateWithdrawal("2026-01-01T17:00:00Z", 6, now)).toBe(true);
    expect(isLateWithdrawal("2026-01-01T19:00:00Z", 6, now)).toBe(false);
  });
});

describe("round robin", () => {
  it.each([2, 3, 4, 5, 6, 7, 8])("schedules every pair exactly once for %i teams", (n) => {
    const fixtures = roundRobin(teams(n), "A");
    const pairs = fixtures.map((f) => [f.home_team_id, f.away_team_id].sort().join("-"));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.length).toBe((n * (n - 1)) / 2);
    for (const t of teams(n)) {
      expect(fixtures.filter((f) => f.home_team_id === t || f.away_team_id === t)).toHaveLength(n - 1);
    }
    // No team plays twice in the same round.
    const rounds = new Map<number, string[]>();
    for (const f of fixtures) rounds.set(f.round, [...(rounds.get(f.round) ?? []), f.home_team_id!, f.away_team_id!]);
    for (const list of rounds.values()) expect(new Set(list).size).toBe(list.length);
  });

  it("rejects duplicate teams", () => {
    expect(() => roundRobin(["a", "a"])).toThrow();
  });
});

describe("single elimination", () => {
  it("produces the standard seed order", () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("gives byes to top seeds and links every match to the next round", () => {
    const fixtures = singleElimination(teams(5));
    expect(fixtures).toHaveLength(7);
    const r1 = fixtures.filter((f) => f.round === 1);
    const byes = r1.filter((f) => (f.home_team_id == null) !== (f.away_team_id == null));
    expect(byes.map((f) => f.home_team_id ?? f.away_team_id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(r1.some((f) => f.home_team_id == null && f.away_team_id == null)).toBe(false);
    const keys = new Set(fixtures.map((f) => f.key));
    for (const f of fixtures.filter((x) => x.round < 3)) expect(keys.has(f.next_key!)).toBe(true);
    const final = fixtures.find((f) => f.round === 3)!;
    expect(final.next_key).toBeNull();
    // Each later-round match is fed by exactly two matches, one per slot.
    for (const target of fixtures.filter((f) => f.round > 1)) {
      const feeders = fixtures.filter((f) => f.next_key === target.key);
      expect(feeders.map((f) => f.next_slot).sort()).toEqual(["away", "home"]);
    }
  });

  it("names rounds", () => {
    expect(roundName(3, 3)).toBe("final");
    expect(roundName(2, 3)).toBe("semi_final");
    expect(roundName(1, 3)).toBe("quarter_final");
  });
});

describe("groups", () => {
  it("snake-assigns seeds across groups", () => {
    expect(assignGroups(teams(8), 2)).toEqual({ t1: "A", t2: "B", t3: "B", t4: "A", t5: "A", t6: "B", t7: "B", t8: "A" });
    expect(() => assignGroups(teams(3), 2)).toThrow();
  });

  it("numbers group fixtures uniquely across groups", () => {
    const fixtures = groupStage(assignGroups(teams(8), 2));
    expect(fixtures).toHaveLength(12);
    expect(new Set(fixtures.map((f) => f.match_number)).size).toBe(12);
    expect(new Set(fixtures.map((f) => f.key)).size).toBe(12);
  });

  it("keeps group mates apart in the first knockout round", () => {
    const row = (teamId: string) => ({ teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 });
    const ko = knockoutFromGroups({ A: [row("A1"), row("A2")], B: [row("B1"), row("B2")] }, 2);
    const r1 = ko.filter((f) => f.round === 1).map((f) => [f.home_team_id, f.away_team_id]);
    expect(r1).toEqual([["A1", "B2"], ["B1", "A2"]]);
  });
});

describe("standings", () => {
  const m = (h: string, a: string, hs: number, as: number, extra: Partial<ResultInput> = {}): ResultInput => ({
    home_team_id: h, away_team_id: a, home_score: hs, away_score: as, status: "completed", result_status: "confirmed", ...extra,
  });

  it("awards points and goal statistics", () => {
    const table = computeStandings(["a", "b", "c"], [m("a", "b", 2, 0), m("b", "c", 1, 1), m("c", "a", 0, 3)]);
    expect(table.map((r) => [r.teamId, r.points, r.goalDifference])).toEqual([["a", 6, 5], ["b", 1, -2], ["c", 1, -3]]);
  });

  it("ignores unconfirmed, scheduled and bye results", () => {
    const table = computeStandings(["a", "b"], [
      m("a", "b", 5, 0, { result_status: "submitted" }),
      m("a", "b", 5, 0, { status: "scheduled" }),
      m("a", "b", 5, 0, { is_bye: true }),
      m("a", "b", 5, 0, { result_status: "disputed" }),
    ]);
    expect(table.every((r) => r.played === 0)).toBe(true);
  });

  it("breaks ties by head-to-head after points, goal difference and goals scored", () => {
    // a and b: 3 pts, GD 0, GF 2 each; b beat a head-to-head. c has more goals.
    const results = [m("b", "a", 1, 0), m("a", "c", 2, 1), m("c", "b", 2, 1)];
    // List a first so only head-to-head (not input order) can put b ahead.
    const table = computeStandings(["a", "b", "c"], results, { win: 3, draw: 1, loss: 0 }, ["a", "b", "c"]);
    const a = table.find((r) => r.teamId === "a")!;
    const b = table.find((r) => r.teamId === "b")!;
    expect([a.points, a.goalDifference, a.goalsFor]).toEqual([3, 0, 2]);
    expect([b.points, b.goalDifference, b.goalsFor]).toEqual([3, 0, 2]);
    expect(table.map((r) => r.teamId)).toEqual(["c", "b", "a"]);
  });

  it("falls back to registration order deterministically", () => {
    const table = computeStandings(["x", "y"], [], undefined, ["y", "x"]);
    expect(table.map((r) => r.teamId)).toEqual(["y", "x"]);
  });

  it("supports custom points rules", () => {
    const table = computeStandings(["a", "b"], [m("a", "b", 1, 1)], { win: 2, draw: 1, loss: 0 });
    expect(table.map((r) => r.points)).toEqual([1, 1]);
  });
});
