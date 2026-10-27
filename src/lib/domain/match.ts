/**
 * Match rules shared by the UI. The database is authoritative: the transition
 * table mirrors `public.match_transition_allowed` and an integration test
 * asserts both agree.
 */

export const MATCH_STATUSES = ["draft", "open", "full", "confirmed", "in_progress", "completed", "cancelled"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "11v11"] as const;
export type MatchFormat = (typeof MATCH_FORMATS)[number];

export const POSITIONS = ["goalkeeper", "defender", "midfielder", "forward"] as const;
export type Position = (typeof POSITIONS)[number];

export const SKILL_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const MATCH_TYPES = ["open", "team_needs_players", "team_vs_team", "private"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const JOIN_POLICIES = ["open", "approval", "invite_only"] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export const BOOKING_STATUSES = ["none", "external", "requested", "confirmed"] as const;
export type MatchBookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_COLLECTORS = ["organizer", "venue", "each_player", "none"] as const;
export type PaymentCollector = (typeof PAYMENT_COLLECTORS)[number];

export const MATCH_TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  draft: ["open", "cancelled"],
  open: ["full", "confirmed", "in_progress", "completed", "cancelled"],
  full: ["open", "confirmed", "in_progress", "completed", "cancelled"],
  confirmed: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return from === to || MATCH_TRANSITIONS[from].includes(to);
}

export function playersPerSide(format: MatchFormat): number {
  return Number(format.split("v")[0]);
}

export function defaultRosterSize(format: MatchFormat): number {
  return playersPerSide(format) * 2;
}

export interface CapacityInput {
  total_players: number;
  reserved_spots: number;
  confirmed_count: number;
}

export function openSlots(m: CapacityInput): number {
  return Math.max(0, m.total_players - m.reserved_spots - m.confirmed_count);
}

export function isJoinableStatus(status: MatchStatus): boolean {
  return status === "open" || status === "full" || status === "confirmed";
}

export type Availability = "available" | "almost_full" | "full" | "closed";

export function availability(m: CapacityInput & { status: MatchStatus; starts_at: string }, now = new Date()): Availability {
  if (!isJoinableStatus(m.status) || new Date(m.starts_at) <= now) return "closed";
  const slots = openSlots(m);
  if (slots === 0) return "full";
  const platformCapacity = m.total_players - m.reserved_spots;
  return slots <= Math.max(1, Math.floor(platformCapacity * 0.2)) ? "almost_full" : "available";
}

/** Whether leaving now would count as a late withdrawal. Mirrors leave_match. */
export function isLateWithdrawal(startsAt: string, leaveDeadlineHours: number, now = new Date()): boolean {
  return now.getTime() > new Date(startsAt).getTime() - leaveDeadlineHours * 3_600_000;
}
