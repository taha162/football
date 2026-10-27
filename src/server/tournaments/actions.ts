"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, intIn, localDateTime, ok, str, uuid, zodFieldErrors, type ActionState } from "@/lib/actions";
import { MATCH_FORMATS } from "@/lib/domain/match";
import { parseMoneyInput } from "@/lib/domain/money";
import { assignGroups, computeStandings, groupStage, knockoutFromGroups, singleElimination, type FixtureSpec } from "@/lib/domain/tournament";
import { toRpcLocal } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Rpc = Parameters<Awaited<ReturnType<typeof createClient>>["rpc"]>[0];

async function run(fn: Rpc, args: Record<string, unknown>, tournamentId: string | undefined, success: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) return fail(dbErrorCode(error, fn));
  if (tournamentId) revalidatePath(`/[locale]/tournaments/${tournamentId}`, "layout");
  revalidatePath("/[locale]/tournaments", "page");
  return ok(typeof data === "string" && /^[a-z_]+$/.test(data) ? `registration_${data}` : success, data);
}

async function locale() {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date");

export async function upsertTournamentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      tournament_id: uuid.optional(),
      name: z.string().trim().min(3, "too_short").max(100, "too_long"),
      city_id: uuid,
      venue_id: uuid.optional(),
      format: z.enum(MATCH_FORMATS),
      tournament_format: z.enum(["round_robin", "single_elimination", "groups_knockout"]),
      team_capacity: intIn(2, 64),
      group_count: intIn(1, 16),
      advance_per_group: intIn(1, 8),
      min_team_size: intIn(1, 30),
      deadline: localDateTime,
      starts_on: date,
      ends_on: date,
      entry_fee: z.string().optional(),
      description: z.string().max(3000, "too_long").optional(),
      eligibility: z.string().max(1000, "too_long").optional(),
      rules: z.string().max(3000, "too_long").optional(),
      prizes: z.string().max(1000, "too_long").optional(),
      points_win: intIn(0, 10),
      points_draw: intIn(0, 10),
      points_loss: intIn(0, 10),
    })
    .refine((v) => v.ends_on >= v.starts_on, { message: "range_invalid", path: ["ends_on"] })
    .safeParse({
      tournament_id: str(fd, "tournament_id"),
      name: str(fd, "name"),
      city_id: str(fd, "city_id"),
      venue_id: str(fd, "venue_id"),
      format: str(fd, "format"),
      tournament_format: str(fd, "tournament_format"),
      team_capacity: str(fd, "team_capacity"),
      group_count: str(fd, "group_count") ?? "1",
      advance_per_group: str(fd, "advance_per_group") ?? "2",
      min_team_size: str(fd, "min_team_size") ?? "5",
      deadline: str(fd, "deadline"),
      starts_on: str(fd, "starts_on"),
      ends_on: str(fd, "ends_on"),
      entry_fee: str(fd, "entry_fee"),
      description: str(fd, "description"),
      eligibility: str(fd, "eligibility"),
      rules: str(fd, "rules"),
      prizes: str(fd, "prizes"),
      points_win: str(fd, "points_win") ?? "3",
      points_draw: str(fd, "points_draw") ?? "1",
      points_loss: str(fd, "points_loss") ?? "0",
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const fee = v.entry_fee ? parseMoneyInput(v.entry_fee, "IQD") : null;
  if (v.entry_fee && fee == null) return fail("validation", { entry_fee: "invalid_amount" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_tournament", {
    p_tournament_id: (v.tournament_id ?? null) as string,
    p_name: v.name,
    p_city_id: v.city_id,
    p_format: v.format,
    p_tournament_format: v.tournament_format,
    p_team_capacity: v.team_capacity,
    p_registration_deadline_local: toRpcLocal(v.deadline),
    p_starts_on: v.starts_on,
    p_ends_on: v.ends_on,
    p_description: v.description,
    p_venue_id: v.venue_id,
    p_group_count: v.tournament_format === "groups_knockout" ? v.group_count : 1,
    p_advance_per_group: v.advance_per_group,
    p_min_team_size: v.min_team_size,
    p_entry_fee: fee ?? undefined,
    p_eligibility: v.eligibility,
    p_rules: v.rules,
    p_prizes: v.prizes,
    p_points_win: v.points_win,
    p_points_draw: v.points_draw,
    p_points_loss: v.points_loss,
  });
  if (error) return fail(dbErrorCode(error, "upsert_tournament"));
  revalidatePath(`/[locale]/tournaments/${data}`, "layout");
  if (!v.tournament_id) redirect({ href: `/tournaments/${data}/manage`, locale: await locale() });
  return ok("tournament_saved");
}

export async function setTournamentStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("tournament_id"));
  const status = z.enum(["registration_open", "registration_closed", "completed", "cancelled"]).safeParse(fd.get("status"));
  if (!id.success || !status.success) return fail("invalid");
  return run("set_tournament_status", { p_tournament_id: id.data, p_status: status.data }, id.data, "tournament_status_updated");
}

export async function registerTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("tournament_id"));
  const team = uuid.safeParse(fd.get("team_id"));
  if (!id.success || !team.success) return fail("invalid");
  return run("register_tournament_team", { p_tournament_id: id.data, p_team_id: team.data }, id.data, "registration_sent");
}

export async function withdrawTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("tournament_id"));
  const team = uuid.safeParse(fd.get("team_id"));
  if (!id.success || !team.success) return fail("invalid");
  return run("withdraw_tournament_team", { p_tournament_id: id.data, p_team_id: team.data }, id.data, "registration_withdrawn");
}

export async function decideRegistrationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const reg = uuid.safeParse(fd.get("registration_id"));
  if (!reg.success) return fail("invalid");
  return run("decide_tournament_registration", { p_registration_id: reg.data, p_approve: fd.get("approve") === "1" }, str(fd, "tournament_id"), "saved");
}

/** Generates fixtures deterministically from approved teams (registration order = seeding). */
export async function generateFixturesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("tournament_id"));
  if (!id.success) return fail("invalid");
  const supabase = await createClient();
  const [{ data: t }, { data: teams }, { data: existing }] = await Promise.all([
    supabase.from("tournaments").select("*").eq("id", id.data).maybeSingle(),
    supabase.from("tournament_teams").select("team_id, group_label, created_at").eq("tournament_id", id.data).eq("status", "approved").order("created_at"),
    supabase.from("tournament_matches").select("*").eq("tournament_id", id.data),
  ]);
  if (!t) return fail("tournament_not_found");
  const seeded = (teams ?? []).map((x) => x.team_id);
  if (seeded.length < 2) return fail("not_enough_teams");
  let fixtures: FixtureSpec[];
  let groups: Record<string, string> | undefined;
  try {
    if (t.tournament_format === "round_robin") {
      fixtures = groupStage(Object.fromEntries(seeded.map((teamId) => [teamId, "A"])));
    } else if (t.tournament_format === "single_elimination") {
      fixtures = singleElimination(seeded);
    } else if ((existing ?? []).length === 0) {
      groups = assignGroups(seeded, t.group_count);
      fixtures = groupStage(groups);
    } else {
      const assigned = Object.fromEntries((teams ?? []).filter((x) => x.group_label).map((x) => [x.team_id, x.group_label!]));
      const labels = [...new Set(Object.values(assigned))].sort();
      const rules = { win: t.points_win, draw: t.points_draw, loss: t.points_loss };
      const byGroup = Object.fromEntries(
        labels.map((label) => {
          const members = seeded.filter((teamId) => assigned[teamId] === label);
          const matches = (existing ?? []).filter((m) => m.stage === "group" && m.group_label === label);
          return [label, computeStandings(members, matches, rules, seeded)];
        }),
      );
      fixtures = knockoutFromGroups(byGroup, t.advance_per_group);
    }
  } catch {
    return fail("not_enough_teams");
  }
  return run("save_tournament_fixtures", { p_tournament_id: id.data, p_fixtures: fixtures, p_groups: groups }, id.data, "fixtures_generated");
}

export async function scheduleFixtureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const match = uuid.safeParse(fd.get("match_id"));
  const when = str(fd, "scheduled_at");
  if (!match.success || (when && !localDateTime.safeParse(when).success)) return fail("invalid");
  return run(
    "set_tournament_fixture_schedule",
    { p_match_id: match.data, p_scheduled_local: when ? toRpcLocal(when) : null, p_location_note: str(fd, "location_note") },
    str(fd, "tournament_id"),
    "saved",
  );
}

export async function recordTournamentResultAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const match = uuid.safeParse(fd.get("match_id"));
  const parsed = z
    .object({ home: intIn(0, 99), away: intIn(0, 99), hp: intIn(0, 99).optional(), ap: intIn(0, 99).optional() })
    .safeParse({ home: fd.get("home_score"), away: fd.get("away_score"), hp: str(fd, "home_penalties"), ap: str(fd, "away_penalties") });
  if (!match.success) return fail("invalid");
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  return run(
    "record_tournament_result",
    { p_match_id: match.data, p_home_score: v.home, p_away_score: v.away, p_home_penalties: v.hp, p_away_penalties: v.ap },
    str(fd, "tournament_id"),
    "result_saved",
  );
}

export async function confirmTournamentResultAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const match = uuid.safeParse(fd.get("match_id"));
  if (!match.success) return fail("invalid");
  return run("confirm_tournament_result", { p_match_id: match.data }, str(fd, "tournament_id"), "result_confirmed");
}

export async function disputeTournamentResultAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const match = uuid.safeParse(fd.get("match_id"));
  if (!match.success) return fail("invalid");
  return run("dispute_tournament_result", { p_match_id: match.data, p_reason: str(fd, "reason") ?? "" }, str(fd, "tournament_id"), "result_disputed");
}

export async function postAnnouncementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({ tournament_id: uuid, title: z.string().trim().min(3, "too_short").max(120, "too_long"), body: z.string().trim().min(1, "required").max(3000, "too_long") })
    .safeParse({ tournament_id: str(fd, "tournament_id"), title: str(fd, "title"), body: str(fd, "body") });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  return run("post_tournament_announcement", { p_tournament_id: parsed.data.tournament_id, p_title: parsed.data.title, p_body: parsed.data.body }, parsed.data.tournament_id, "announcement_posted");
}
