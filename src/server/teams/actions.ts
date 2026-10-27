"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { bool, dbErrorCode, fail, intIn, localDateTime, ok, str, strs, uuid, zodFieldErrors, type ActionState } from "@/lib/actions";
import { MATCH_FORMATS, POSITIONS, SKILL_LEVELS } from "@/lib/domain/match";
import { parseMoneyInput } from "@/lib/domain/money";
import { toRpcLocal } from "@/lib/format";
import { inspectImage, randomFileName } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

type Rpc = Parameters<Awaited<ReturnType<typeof createClient>>["rpc"]>[0];

async function run(fn: Rpc, args: Record<string, unknown>, teamId: string | undefined, success: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) return fail(dbErrorCode(error, fn));
  if (teamId) revalidatePath(`/[locale]/teams/${teamId}`, "layout");
  revalidatePath("/[locale]/teams", "page");
  revalidatePath("/[locale]/dashboard", "page");
  return ok(success, data);
}

async function locale() {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

const teamSchema = z.object({
  name: z.string().trim().min(2, "too_short").max(60, "too_long"),
  city_id: uuid,
  area_id: uuid.optional(),
  description: z.string().max(1000, "too_long").optional(),
  visibility: z.enum(["public", "private"]),
  join_policy: z.enum(["request", "invite_only"]),
  skill_level: z.enum(SKILL_LEVELS).optional(),
  preferred_format: z.enum(MATCH_FORMATS).optional(),
  preferred_formation: z.string().regex(/^[0-9]{1,2}(-[0-9]{1,2}){1,4}$/, "invalid_formation").optional(),
  home_venue_id: uuid.optional(),
});

function parseTeam(fd: FormData) {
  return teamSchema.safeParse({
    name: str(fd, "name"),
    city_id: str(fd, "city_id"),
    area_id: str(fd, "area_id"),
    description: str(fd, "description"),
    visibility: str(fd, "visibility") ?? "public",
    join_policy: str(fd, "join_policy") ?? "request",
    skill_level: str(fd, "skill_level"),
    preferred_format: str(fd, "preferred_format"),
    preferred_formation: str(fd, "preferred_formation"),
    home_venue_id: str(fd, "home_venue_id"),
  });
}

export async function createTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseTeam(fd);
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_team", {
    p_name: v.name,
    p_city_id: v.city_id,
    p_area_id: v.area_id,
    p_description: v.description,
    p_visibility: v.visibility,
    p_join_policy: v.join_policy,
    p_skill_level: v.skill_level,
    p_preferred_format: v.preferred_format,
    p_preferred_formation: v.preferred_formation,
  });
  if (error) return fail(dbErrorCode(error, "create_team"));
  redirect({ href: `/teams/${data as string}/manage`, locale: await locale() });
  return ok();
}

export async function updateTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("team_id"));
  const parsed = parseTeam(fd);
  if (!id.success) return fail("invalid");
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  return run(
    "update_team",
    {
      p_team_id: id.data,
      p_name: v.name,
      p_city_id: v.city_id,
      p_area_id: v.area_id,
      p_description: v.description,
      p_visibility: v.visibility,
      p_join_policy: v.join_policy,
      p_skill_level: v.skill_level,
      p_preferred_format: v.preferred_format,
      p_preferred_formation: v.preferred_formation,
      p_home_venue_id: v.home_venue_id,
    },
    id.data,
    "team_saved",
  );
}

export async function uploadTeamLogoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("team_id"));
  const file = fd.get("logo");
  if (!id.success || !(file instanceof File)) return fail("file_missing");
  const img = await inspectImage(file);
  if (!img.ok) return fail(img.error);
  const supabase = await createClient();
  const { data: team } = await supabase.from("teams").select("logo_path").eq("id", id.data).maybeSingle();
  const path = `${id.data}/${randomFileName(img.ext)}`;
  const { error: upErr } = await supabase.storage.from("team-logos").upload(path, img.bytes, { contentType: img.mime });
  if (upErr) return fail("upload_failed");
  const { error } = await supabase.rpc("set_team_logo", { p_team_id: id.data, p_path: path });
  if (error) {
    await supabase.storage.from("team-logos").remove([path]);
    return fail(dbErrorCode(error, "set_team_logo"));
  }
  if (team?.logo_path) await supabase.storage.from("team-logos").remove([team.logo_path]);
  revalidatePath(`/[locale]/teams/${id.data}`, "layout");
  return ok("logo_updated");
}

export async function inviteToTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const team = uuid.safeParse(fd.get("team_id"));
  const user = uuid.safeParse(fd.get("user_id"));
  if (!team.success || !user.success) return fail("invalid");
  return run("invite_to_team", { p_team_id: team.data, p_user_id: user.data, p_message: str(fd, "message") }, team.data, "invitation_sent");
}

export async function respondTeamInvitationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const inv = uuid.safeParse(fd.get("invitation_id"));
  if (!inv.success) return fail("invalid");
  const accept = bool(fd, "accept");
  return run("respond_team_invitation", { p_invitation_id: inv.data, p_accept: accept }, str(fd, "team_id"), accept ? "joined_team" : "saved");
}

export async function revokeTeamInvitationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const inv = uuid.safeParse(fd.get("invitation_id"));
  if (!inv.success) return fail("invalid");
  return run("revoke_team_invitation", { p_invitation_id: inv.data }, str(fd, "team_id"), "invitation_revoked");
}

export async function requestToJoinTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const team = uuid.safeParse(fd.get("team_id"));
  if (!team.success) return fail("invalid");
  const position = z.enum(POSITIONS).optional().safeParse(str(fd, "position"));
  return run(
    "request_to_join_team",
    {
      p_team_id: team.data,
      p_message: str(fd, "message"),
      p_position: position.success ? position.data : undefined,
      p_recruitment_id: str(fd, "recruitment_id"),
    },
    team.data,
    "request_sent",
  );
}

export async function withdrawJoinRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const req = uuid.safeParse(fd.get("request_id"));
  if (!req.success) return fail("invalid");
  return run("withdraw_join_request", { p_request_id: req.data }, str(fd, "team_id"), "request_withdrawn");
}

export async function decideJoinRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const req = uuid.safeParse(fd.get("request_id"));
  if (!req.success) return fail("invalid");
  return run("decide_join_request", { p_request_id: req.data, p_approve: bool(fd, "approve") }, str(fd, "team_id"), "saved");
}

export async function setMemberRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const team = uuid.safeParse(fd.get("team_id"));
  const user = uuid.safeParse(fd.get("user_id"));
  const role = z.enum(["captain", "manager", "player"]).safeParse(fd.get("role"));
  if (!team.success || !user.success || !role.success) return fail("invalid");
  return run("set_team_member_role", { p_team_id: team.data, p_user_id: user.data, p_role: role.data }, team.data, "role_updated");
}

export async function removeMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const team = uuid.safeParse(fd.get("team_id"));
  const user = uuid.safeParse(fd.get("user_id"));
  if (!team.success || !user.success) return fail("invalid");
  return run("remove_team_member", { p_team_id: team.data, p_user_id: user.data }, team.data, "member_removed");
}

export async function leaveTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const team = uuid.safeParse(fd.get("team_id"));
  if (!team.success) return fail("invalid");
  return run("leave_team", { p_team_id: team.data }, team.data, "left_team");
}

export async function setMyTeamPositionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const team = uuid.safeParse(fd.get("team_id"));
  const position = z.enum(POSITIONS).safeParse(fd.get("position"));
  if (!team.success || !position.success) return fail("invalid");
  return run("set_my_team_position", { p_team_id: team.data, p_position: position.data }, team.data, "saved");
}

export async function archiveTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const team = uuid.safeParse(fd.get("team_id"));
  if (!team.success) return fail("invalid");
  const res = await run("archive_team", { p_team_id: team.data }, team.data, "team_archived");
  if (res?.ok) redirect({ href: "/my/teams", locale: await locale() });
  return res;
}

export async function createRecruitmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      team_id: uuid,
      title: z.string().trim().min(3, "too_short").max(100, "too_long"),
      description: z.string().max(1000, "too_long").optional(),
      positions: z.array(z.enum(POSITIONS)),
      players_needed: intIn(1, 30),
      skill_level: z.enum(SKILL_LEVELS).optional(),
      expires_in_days: intIn(1, 60),
    })
    .safeParse({
      team_id: str(fd, "team_id"),
      title: str(fd, "title"),
      description: str(fd, "description"),
      positions: strs(fd, "positions"),
      players_needed: str(fd, "players_needed") ?? "1",
      skill_level: str(fd, "skill_level"),
      expires_in_days: str(fd, "expires_in_days") ?? "14",
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  return run(
    "create_recruitment",
    {
      p_team_id: v.team_id,
      p_title: v.title,
      p_description: v.description,
      p_positions: v.positions,
      p_players_needed: v.players_needed,
      p_skill_level: v.skill_level,
      p_expires_in_days: v.expires_in_days,
    },
    v.team_id,
    "recruitment_published",
  );
}

export async function closeRecruitmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("recruitment_id"));
  if (!id.success) return fail("invalid");
  return run("close_recruitment", { p_recruitment_id: id.data }, str(fd, "team_id"), "recruitment_closed");
}

// ---------------------------------------------------------------------------
// Opponent matchmaking
// ---------------------------------------------------------------------------
export async function createOpponentRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      team_id: uuid,
      earliest: localDateTime,
      latest: localDateTime,
      format: z.enum(MATCH_FORMATS),
      area_ids: z.array(uuid),
      skill_level: z.enum(SKILL_LEVELS).optional(),
      venue_id: uuid.optional(),
      venue_note: z.string().max(300, "too_long").optional(),
      cost: z.string().optional(),
      rules: z.string().max(1000, "too_long").optional(),
      notes: z.string().max(1000, "too_long").optional(),
    })
    .refine((v) => v.latest >= v.earliest, { message: "range_invalid", path: ["latest"] })
    .safeParse({
      team_id: str(fd, "team_id"),
      earliest: str(fd, "earliest"),
      latest: str(fd, "latest"),
      format: str(fd, "format"),
      area_ids: strs(fd, "area_ids"),
      skill_level: str(fd, "skill_level"),
      venue_id: str(fd, "venue_id"),
      venue_note: str(fd, "venue_note"),
      cost: str(fd, "cost"),
      rules: str(fd, "rules"),
      notes: str(fd, "notes"),
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const cost = v.cost ? parseMoneyInput(v.cost, "IQD") : null;
  if (v.cost && cost == null) return fail("validation", { cost: "invalid_amount" });
  const res = await run(
    "create_opponent_request",
    {
      p_team_id: v.team_id,
      p_earliest_local: toRpcLocal(v.earliest),
      p_latest_local: toRpcLocal(v.latest),
      p_format: v.format,
      p_area_ids: v.area_ids,
      p_skill_level: v.skill_level,
      p_venue_id: v.venue_id,
      p_venue_note: v.venue_note,
      p_cost_per_team: cost ?? undefined,
      p_rules: v.rules,
      p_notes: v.notes,
    },
    v.team_id,
    "opponent_request_published",
  );
  revalidatePath("/[locale]/opponents", "page");
  return res;
}

export async function closeOpponentRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("request_id"));
  if (!id.success) return fail("invalid");
  const res = await run("close_opponent_request", { p_request_id: id.data }, undefined, "opponent_request_closed");
  revalidatePath("/[locale]/opponents", "page");
  return res;
}

export async function sendChallengeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      challenger_team_id: uuid,
      request_id: uuid.optional(),
      target_team_id: uuid.optional(),
      start: localDateTime,
      duration: intIn(30, 240),
      format: z.enum(MATCH_FORMATS).optional(),
      venue_id: uuid.optional(),
      location_note: z.string().max(300, "too_long").optional(),
      cost: z.string().optional(),
      message: z.string().max(1000, "too_long").optional(),
    })
    .safeParse({
      challenger_team_id: str(fd, "challenger_team_id"),
      request_id: str(fd, "request_id"),
      target_team_id: str(fd, "target_team_id"),
      start: str(fd, "start"),
      duration: str(fd, "duration") ?? "60",
      format: str(fd, "format"),
      venue_id: str(fd, "venue_id"),
      location_note: str(fd, "location_note"),
      cost: str(fd, "cost"),
      message: str(fd, "message"),
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const cost = v.cost ? parseMoneyInput(v.cost, "IQD") : null;
  if (v.cost && cost == null) return fail("validation", { cost: "invalid_amount" });
  const res = await run(
    "send_challenge",
    {
      p_challenger_team_id: v.challenger_team_id,
      p_request_id: v.request_id,
      p_target_team_id: v.target_team_id,
      p_start_local: toRpcLocal(v.start),
      p_duration_minutes: v.duration,
      p_format: v.format,
      p_venue_id: v.venue_id,
      p_location_note: v.location_note,
      p_cost_per_team: cost ?? undefined,
      p_message: v.message,
    },
    v.target_team_id,
    "challenge_sent",
  );
  revalidatePath("/[locale]/opponents", "page");
  return res;
}

export async function respondChallengeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("challenge_id"));
  if (!id.success) return fail("invalid");
  const accept = bool(fd, "accept");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_challenge", { p_challenge_id: id.data, p_accept: accept });
  if (error) return fail(dbErrorCode(error, "respond_challenge"));
  revalidatePath("/[locale]/opponents", "page");
  if (accept && data) redirect({ href: `/matches/${data}`, locale: await locale() });
  return ok("challenge_declined");
}

export async function withdrawChallengeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("challenge_id"));
  if (!id.success) return fail("invalid");
  const res = await run("withdraw_challenge", { p_challenge_id: id.data }, undefined, "challenge_withdrawn");
  revalidatePath("/[locale]/opponents", "page");
  return res;
}
