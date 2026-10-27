/**
 * Deterministic tournament structures: round-robin schedules, single
 * elimination brackets (with byes), group assignment and standings.
 *
 * Output fixtures match the payload accepted by
 * `public.save_tournament_fixtures`, which validates and stores them.
 */

export type Stage = "group" | "knockout";

export interface FixtureSpec {
  key: string;
  stage: Stage;
  round: number;
  match_number: number;
  group_label: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  next_key: string | null;
  next_slot: "home" | "away" | null;
}

const GROUP_LABELS = "ABCDEFGHIJKLMNOP";

/**
 * Round-robin schedule using the circle method. Every pair meets exactly
 * once; with an odd number of teams one team rests each round.
 */
export function roundRobin(teamIds: readonly string[], groupLabel: string | null = null, matchNumberStart = 1): FixtureSpec[] {
  assertUnique(teamIds);
  if (teamIds.length < 2) throw new Error("round robin needs at least 2 teams");
  const slots: (string | null)[] = [...teamIds];
  if (slots.length % 2 === 1) slots.push(null);
  const n = slots.length;
  const fixtures: FixtureSpec[] = [];
  let matchNumber = matchNumberStart;
  const rotating = slots.slice(1);
  for (let round = 1; round <= n - 1; round++) {
    const order = [slots[0], ...rotating];
    for (let i = 0; i < n / 2; i++) {
      let home = order[i];
      let away = order[n - 1 - i];
      if (home == null || away == null) continue;
      // Alternate home/away so the fixed team is not always at home.
      if ((i === 0 && round % 2 === 0) || (i > 0 && i % 2 === 1)) [home, away] = [away, home];
      fixtures.push({
        key: `${groupLabel ?? "L"}-r${round}-m${matchNumber}`,
        stage: "group",
        round,
        match_number: matchNumber++,
        group_label: groupLabel,
        home_team_id: home,
        away_team_id: away,
        next_key: null,
        next_slot: null,
      });
    }
    rotating.unshift(rotating.pop()!);
  }
  return fixtures;
}

/** Standard bracket seed order, e.g. size 8 -> [1, 8, 4, 5, 2, 7, 3, 6]. */
export function bracketSeedOrder(size: number): number[] {
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error("bracket size must be a power of two >= 2");
  let order = [1, 2];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((s) => [s, next - s]);
  }
  return order;
}

export function nextPowerOfTwo(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/**
 * Single-elimination bracket. `seededTeamIds[0]` is the top seed. Byes go to
 * the highest seeds; a first-round fixture with one team is a bye and the
 * database advances that team automatically.
 */
export function singleElimination(seededTeamIds: readonly string[]): FixtureSpec[] {
  assertUnique(seededTeamIds);
  if (seededTeamIds.length < 2) throw new Error("knockout needs at least 2 teams");
  const size = nextPowerOfTwo(seededTeamIds.length);
  const order = bracketSeedOrder(size);
  const rounds = Math.log2(size);
  const fixtures: FixtureSpec[] = [];
  let matchNumber = 1;
  const key = (round: number, index: number) => `KO-r${round}-i${index}`;
  for (let round = 1; round <= rounds; round++) {
    const matchesInRound = size / 2 ** round;
    for (let i = 0; i < matchesInRound; i++) {
      const isLast = round === rounds;
      const home = round === 1 ? (seededTeamIds[order[2 * i] - 1] ?? null) : null;
      const away = round === 1 ? (seededTeamIds[order[2 * i + 1] - 1] ?? null) : null;
      fixtures.push({
        key: key(round, i),
        stage: "knockout",
        round,
        match_number: matchNumber++,
        group_label: null,
        home_team_id: home,
        away_team_id: away,
        next_key: isLast ? null : key(round + 1, Math.floor(i / 2)),
        next_slot: isLast ? null : i % 2 === 0 ? "home" : "away",
      });
    }
  }
  return fixtures;
}

/** Snake-draft assignment of seeded teams into groups: A B C C B A A B C ... */
export function assignGroups(seededTeamIds: readonly string[], groupCount: number): Record<string, string> {
  assertUnique(seededTeamIds);
  if (groupCount < 1 || groupCount > GROUP_LABELS.length) throw new Error("invalid group count");
  if (seededTeamIds.length < groupCount * 2) throw new Error("each group needs at least 2 teams");
  const result: Record<string, string> = {};
  seededTeamIds.forEach((teamId, index) => {
    const lap = Math.floor(index / groupCount);
    const pos = index % groupCount;
    const groupIndex = lap % 2 === 0 ? pos : groupCount - 1 - pos;
    result[teamId] = GROUP_LABELS[groupIndex];
  });
  return result;
}

/** Group-stage fixtures for every group, with globally unique match numbers. */
export function groupStage(groups: Record<string, string>): FixtureSpec[] {
  const byGroup = new Map<string, string[]>();
  for (const [teamId, label] of Object.entries(groups)) {
    byGroup.set(label, [...(byGroup.get(label) ?? []), teamId]);
  }
  const fixtures: FixtureSpec[] = [];
  for (const label of [...byGroup.keys()].sort()) {
    fixtures.push(...roundRobin(byGroup.get(label)!, label, fixtures.length + 1));
  }
  return fixtures;
}

/**
 * Knockout bracket from group standings. Qualifiers are seeded group winners
 * first (A1, B1, ...), then runners-up (A2, B2, ...), which keeps teams from
 * the same group apart in the first round for standard group counts.
 */
export function knockoutFromGroups(standingsByGroup: Record<string, readonly StandingRow[]>, advancePerGroup: number): FixtureSpec[] {
  const labels = Object.keys(standingsByGroup).sort();
  const seeds: string[] = [];
  for (let place = 0; place < advancePerGroup; place++) {
    for (const label of labels) {
      const row = standingsByGroup[label][place];
      if (row) seeds.push(row.teamId);
    }
  }
  return singleElimination(seeds);
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface ResultInput {
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "completed" | "cancelled";
  result_status?: "none" | "submitted" | "confirmed" | "disputed";
  is_bye?: boolean;
}

export interface PointsRules {
  win: number;
  draw: number;
  loss: number;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

/** Only confirmed, completed, non-bye results count toward standings. */
export function countsForStandings(m: ResultInput): boolean {
  return (
    m.status === "completed" &&
    !m.is_bye &&
    (m.result_status === undefined || m.result_status === "confirmed") &&
    m.home_team_id != null &&
    m.away_team_id != null &&
    m.home_score != null &&
    m.away_score != null
  );
}

function tally(teamIds: readonly string[], matches: readonly ResultInput[], rules: PointsRules): Map<string, StandingRow> {
  const rows = new Map<string, StandingRow>(
    teamIds.map((id) => [
      id,
      { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 },
    ]),
  );
  for (const m of matches) {
    if (!countsForStandings(m)) continue;
    const home = rows.get(m.home_team_id!);
    const away = rows.get(m.away_team_id!);
    if (!home || !away) continue;
    const hs = m.home_score!;
    const as = m.away_score!;
    home.played++;
    away.played++;
    home.goalsFor += hs;
    home.goalsAgainst += as;
    away.goalsFor += as;
    away.goalsAgainst += hs;
    if (hs > as) {
      home.won++;
      away.lost++;
      home.points += rules.win;
      away.points += rules.loss;
    } else if (hs < as) {
      away.won++;
      home.lost++;
      away.points += rules.win;
      home.points += rules.loss;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += rules.draw;
      away.points += rules.draw;
    }
  }
  for (const row of rows.values()) row.goalDifference = row.goalsFor - row.goalsAgainst;
  return rows;
}

/**
 * Standings with deterministic tie-breakers, in order:
 *   1. points  2. goal difference  3. goals scored
 *   4. head-to-head points among the tied teams  5. head-to-head goal difference
 *   6. wins  7. registration order (`order`, lower first)  8. team id
 */
export function computeStandings(
  teamIds: readonly string[],
  matches: readonly ResultInput[],
  rules: PointsRules = { win: 3, draw: 1, loss: 0 },
  order: readonly string[] = teamIds,
): StandingRow[] {
  const rows = [...tally(teamIds, matches, rules).values()];
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  const primary = (a: StandingRow, b: StandingRow) =>
    b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor;
  rows.sort(primary);

  const result: StandingRow[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && primary(rows[i], rows[j]) === 0) j++;
    const cluster = rows.slice(i, j);
    if (cluster.length > 1) {
      const ids = cluster.map((r) => r.teamId);
      const idSet = new Set(ids);
      const h2h = tally(
        ids,
        matches.filter((m) => idSet.has(m.home_team_id ?? "") && idSet.has(m.away_team_id ?? "")),
        rules,
      );
      cluster.sort((a, b) => {
        const ha = h2h.get(a.teamId)!;
        const hb = h2h.get(b.teamId)!;
        return (
          hb.points - ha.points ||
          hb.goalDifference - ha.goalDifference ||
          b.won - a.won ||
          (orderIndex.get(a.teamId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.teamId) ?? Number.MAX_SAFE_INTEGER) ||
          (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0)
        );
      });
    }
    result.push(...cluster);
    i = j;
  }
  return result;
}

export function roundName(round: number, totalRounds: number): "final" | "semi_final" | "quarter_final" | "round_of" {
  const remaining = totalRounds - round;
  if (remaining === 0) return "final";
  if (remaining === 1) return "semi_final";
  if (remaining === 2) return "quarter_final";
  return "round_of";
}

function assertUnique(ids: readonly string[]) {
  if (new Set(ids).size !== ids.length) throw new Error("team ids must be unique");
}
