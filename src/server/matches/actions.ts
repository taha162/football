"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { bool, dbErrorCode, fail, intIn, localDateTime, ok, str, uuid, zodFieldErrors, type ActionState } from "@/lib/actions";
import { JOIN_POLICIES, MATCH_FORMATS, PAYMENT_COLLECTORS, POSITIONS, SKILL_LEVELS } from "@/lib/domain/match";
import { parseMoneyInput } from "@/lib/domain/money";
import { toRpcLocal } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Rpc = Parameters<Awaited<ReturnType<typeof createClient>>["rpc"]>[0];

/** Calls an RPC, revalidates the match page and maps errors to codes. */
async function run(fn: Rpc, args: Record<string, unknown>, matchId: string | undefined, success: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) return fail(dbErrorCode(error, fn));
  if (matchId) revalidatePath(`/[locale]/matches/${matchId}`, "page");
  revalidatePath("/[locale]/matches", "page");
  revalidatePath("/[locale]/dashboard", "page");
  const result = (data as { result?: string } | null)?.result;
  return ok(result ? `match_${result}` : success, data);
}

async function locale() {
  const l = await getLocale();
  return isLocale(l) ? l : "ar";
}

const money = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const n = parseMoneyInput(v, "IQD");
    if (n == null) {
      ctx.addIssue({ code: "custom", message: "invalid_amount" });
      return z.NEVER;
    }
    return n;
  });

const positionsNeeded = (fd: FormData) => {
  const out: Record<string, number> = {};
  for (const p of POSITIONS) {
    const n = Number(fd.get(`need_${p}`) ?? 0);
    if (Number.isInteger(n) && n > 0) out[p] = n;
  }
  return out;
};

const matchSchema = z.object({
  title: z.string().trim().min(3, "too_short").max(100, "too_long"),
  description: z.string().max(2000, "too_long").optional(),
  area_id: uuid.optional(),
  venue_id: uuid.optional(),
  field_id: uuid.optional(),
  location_note: z.string().max(300, "too_long").optional(),
  start: localDateTime,
  duration: intIn(30, 360),
  total_players: intIn(2, 30),
  reserved_spots: intIn(0, 29),
  skill_level: z.enum(SKILL_LEVELS).optional(),
  total_cost: money,
  paying_players: intIn(1, 60).optional(),
  price_per_player: money,
  cost_is_estimate: z.boolean(),
  payment_collector: z.enum(PAYMENT_COLLECTORS),
  payment_notes: z.string().max(500, "too_long").optional(),
  rules: z.string().max(1000, "too_long").optional(),
  visibility: z.enum(["public", "private"]),
  join_policy: z.enum(JOIN_POLICIES),
  leave_deadline_hours: intIn(0, 72),
  external_booking: z.boolean(),
});

function parseMatch(fd: FormData) {
  return matchSchema
    .refine((v) => v.reserved_spots < v.total_players, { message: "reserved_too_many", path: ["reserved_spots"] })
    .safeParse({
      title: str(fd, "title"),
      description: str(fd, "description"),
      area_id: str(fd, "area_id"),
      venue_id: str(fd, "venue_id"),
      field_id: str(fd, "field_id"),
      location_note: str(fd, "location_note"),
      start: str(fd, "start"),
      duration: str(fd, "duration"),
      total_players: str(fd, "total_players"),
      reserved_spots: str(fd, "reserved_spots") ?? "0",
      skill_level: str(fd, "skill_level"),
      total_cost: str(fd, "total_cost"),
      paying_players: str(fd, "paying_players"),
      price_per_player: str(fd, "price_per_player"),
      cost_is_estimate: bool(fd, "cost_is_estimate"),
      payment_collector: str(fd, "payment_collector") ?? "organizer",
      payment_notes: str(fd, "payment_notes"),
      rules: str(fd, "rules"),
      visibility: str(fd, "visibility") ?? "public",
      join_policy: str(fd, "join_policy") ?? "open",
      leave_deadline_hours: str(fd, "leave_deadline_hours") ?? "6",
      external_booking: bool(fd, "external_booking"),
    });
}

function commonArgs(v: z.infer<typeof matchSchema>, fd: FormData) {
  return {
    p_title: v.title,
    p_description: v.description,
    p_area_id: v.area_id,
    p_venue_id: v.venue_id,
    p_field_id: v.venue_id ? v.field_id : undefined,
    p_location_note: v.location_note,
    p_start_local: toRpcLocal(v.start),
    p_duration_minutes: v.duration,
    p_total_players: v.total_players,
    p_reserved_spots: v.reserved_spots,
    p_positions_needed: positionsNeeded(fd),
    p_skill_level: v.skill_level,
    p_total_cost: v.total_cost,
    p_paying_players: v.paying_players,
    p_price_per_player: v.price_per_player,
    p_cost_is_estimate: v.cost_is_estimate,
    p_payment_collector: v.payment_collector,
    p_payment_notes: v.payment_notes,
    p_rules: v.rules,
    p_visibility: v.visibility,
    p_join_policy: v.join_policy,
    p_leave_deadline_hours: v.leave_deadline_hours,
    p_external_booking: v.external_booking,
  };
}

export async function createMatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseMatch(fd);
  const extra = z
    .object({
      city_id: uuid,
      format: z.enum(MATCH_FORMATS),
      match_type: z.enum(["open", "team_needs_players", "private"]),
      team_id: uuid.optional(),
      organizer_plays: z.boolean(),
      organizer_position: z.enum(POSITIONS).optional(),
      publish: z.boolean(),
      repeat_weeks: intIn(0, 11),
    })
    .safeParse({
      city_id: str(fd, "city_id"),
      format: str(fd, "format"),
      match_type: str(fd, "match_type") ?? "open",
      team_id: str(fd, "team_id"),
      organizer_plays: bool(fd, "organizer_plays"),
      organizer_position: str(fd, "organizer_position"),
      publish: str(fd, "intent") !== "draft",
      repeat_weeks: str(fd, "repeat_weeks") ?? "0",
    });
  if (!parsed.success || !extra.success) {
    return fail("validation", { ...(parsed.error ? zodFieldErrors(parsed.error) : {}), ...(extra.error ? zodFieldErrors(extra.error) : {}) });
  }
  const e = extra.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_match", {
    ...commonArgs(parsed.data, fd),
    p_city_id: e.city_id,
    p_format: e.format,
    p_match_type: e.match_type,
    p_team_id: e.match_type === "team_needs_players" ? e.team_id : undefined,
    p_organizer_plays: e.organizer_plays,
    p_organizer_position: e.organizer_position,
    p_publish: e.publish,
    p_repeat_weeks: e.repeat_weeks,
  } as never);
  if (error) return fail(dbErrorCode(error, "create_match"));
  revalidatePath("/[locale]/matches", "page");
  redirect({ href: `/matches/${data as string}`, locale: await locale() });
  return ok();
}

export async function updateMatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = uuid.safeParse(fd.get("match_id"));
  if (!id.success) return fail("invalid");
  const parsed = parseMatch(fd);
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_match", { p_match_id: id.data, ...commonArgs(parsed.data, fd) } as never);
  if (error) return fail(dbErrorCode(error, "update_match"));
  revalidatePath(`/[locale]/matches/${id.data}`, "page");
  redirect({ href: `/matches/${id.data}`, locale: await locale() });
  return ok();
}

function matchId(fd: FormData) {
  const r = uuid.safeParse(fd.get("match_id"));
  return r.success ? r.data : null;
}

export async function joinMatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  if (!id) return fail("invalid");
  const position = z.enum(POSITIONS).optional().safeParse(str(fd, "position"));
  return run("join_match", { p_match_id: id, p_position: position.success ? position.data : undefined, p_waitlist_if_full: bool(fd, "waitlist") }, id, "match_joined");
}

export async function leaveMatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  if (!id) return fail("invalid");
  return run("leave_match", { p_match_id: id }, id, "match_left");
}

export async function updateMyPositionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  const position = z.enum(POSITIONS).safeParse(str(fd, "position"));
  if (!id || !position.success) return fail("invalid");
  return run("update_my_match_position", { p_match_id: id, p_position: position.data }, id, "saved");
}

export async function lifecycleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  const op = z.enum(["publish_match", "confirm_match", "start_match", "complete_match", "cancel_match"]).safeParse(fd.get("op"));
  if (!id || !op.success) return fail("invalid");
  const args: Record<string, unknown> = { p_match_id: id };
  if (op.data === "cancel_match") args.p_reason = str(fd, "reason");
  return run(op.data, args, id, `match_${op.data}`);
}

export async function decideParticipantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const pid = uuid.safeParse(fd.get("participant_id"));
  if (!pid.success) return fail("invalid");
  return run("decide_match_participant", { p_participant_id: pid.data, p_approve: bool(fd, "approve") }, str(fd, "match_id"), "saved");
}

export async function removeParticipantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const pid = uuid.safeParse(fd.get("participant_id"));
  if (!pid.success) return fail("invalid");
  return run("remove_match_participant", { p_participant_id: pid.data, p_reason: str(fd, "reason") }, str(fd, "match_id"), "participant_removed");
}

export async function participantDetailsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const pid = uuid.safeParse(fd.get("participant_id"));
  if (!pid.success) return fail("invalid");
  const parsed = z
    .object({
      team_side: z.enum(["home", "away"]).optional(),
      payment_status: z.enum(["unpaid", "paid", "waived"]).optional(),
      attendance: z.enum(["attended", "no_show", "excused"]).optional(),
    })
    .safeParse({ team_side: str(fd, "team_side"), payment_status: str(fd, "payment_status"), attendance: str(fd, "attendance") });
  if (!parsed.success) return fail("invalid");
  return run(
    "set_participant_details",
    { p_participant_id: pid.data, p_team_side: parsed.data.team_side, p_payment_status: parsed.data.payment_status, p_attendance: parsed.data.attendance },
    str(fd, "match_id"),
    "saved",
  );
}

export async function inviteToMatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  const user = uuid.safeParse(fd.get("user_id"));
  if (!id || !user.success) return fail("invalid");
  return run("invite_to_match", { p_match_id: id, p_user_id: user.data }, id, "invitation_sent");
}

export async function revokeMatchInvitationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const inv = uuid.safeParse(fd.get("invitation_id"));
  if (!inv.success) return fail("invalid");
  return run("revoke_match_invitation", { p_invitation_id: inv.data }, str(fd, "match_id"), "invitation_revoked");
}

export async function respondMatchInvitationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const inv = uuid.safeParse(fd.get("invitation_id"));
  if (!inv.success) return fail("invalid");
  const position = z.enum(POSITIONS).optional().safeParse(str(fd, "position"));
  return run(
    "respond_match_invitation",
    { p_invitation_id: inv.data, p_accept: bool(fd, "accept"), p_position: position.success ? position.data : undefined },
    str(fd, "match_id"),
    "saved",
  );
}

export async function reportResultAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  const parsed = z.object({ home: intIn(0, 99), away: intIn(0, 99) }).safeParse({ home: fd.get("home_score"), away: fd.get("away_score") });
  if (!id) return fail("invalid");
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  return run("report_match_result", { p_match_id: id, p_home_score: parsed.data.home, p_away_score: parsed.data.away }, id, "result_reported");
}

export async function respondResultAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  if (!id) return fail("invalid");
  return run("respond_match_result", { p_match_id: id, p_confirm: bool(fd, "confirm"), p_reason: str(fd, "reason") }, id, "saved");
}

export async function setEventsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  if (!id) return fail("invalid");
  const events: { user_id: string; event_type: string; minute?: number }[] = [];
  for (const [key, value] of fd.entries()) {
    const m = /^count_(goal|assist|clean_sheet|own_goal)_([0-9a-f-]{36})$/.exec(key);
    if (!m) continue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 20) return fail("validation", { [key]: "out_of_range" });
    for (let i = 0; i < n; i++) events.push({ event_type: m[1], user_id: m[2] });
  }
  return run("set_match_events", { p_match_id: id, p_events: events }, id, "events_saved");
}

export async function linkBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = matchId(fd);
  const booking = uuid.safeParse(fd.get("booking_id"));
  if (!id || !booking.success) return fail("invalid");
  return run("link_match_booking", { p_match_id: id, p_booking_id: booking.data }, id, "booking_linked");
}
