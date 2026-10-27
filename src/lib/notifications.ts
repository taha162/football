/**
 * Maps notification types to destinations. Text is rendered from the
 * `notifications.<type>` translation with the payload as ICU arguments.
 */
export type NotificationPayload = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function notificationHref(type: string, p: NotificationPayload): string {
  if (p.match_id) return `/matches/${str(p.match_id)}`;
  if (p.conversation_id) return `/messages/${str(p.conversation_id)}`;
  if (p.tournament_id) return `/tournaments/${str(p.tournament_id)}`;
  if (type.startsWith("booking")) {
    return type === "booking_requested" || type === "booking_new_confirmed" ? `/manage/venues/${str(p.venue_id)}` : "/my/bookings";
  }
  if (type.startsWith("challenge")) return "/opponents";
  if (type === "team_join_request" || type === "recruitment_response") return `/teams/${str(p.team_id)}/manage`;
  if (p.team_id) return `/teams/${str(p.team_id)}`;
  if (type === "venue_verification" || type === "venue_staff_added") return `/manage/venues/${str(p.venue_id)}`;
  if (type === "review_received") return "/profile";
  return "/notifications";
}

/** ICU-safe argument values (strings/numbers only). */
export function notificationArgs(p: NotificationPayload, formatDate: (iso: string) => string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "number") out[k] = v;
    else if (typeof v === "boolean") out[k] = v ? "yes" : "no";
    else if (typeof v === "string") out[k] = k.endsWith("_at") ? formatDate(v) : v;
  }
  return out;
}

/** Types users may switch off in settings (others are mandatory). */
export const OPTIONAL_NOTIFICATION_TYPES = [
  "match_participant_joined",
  "match_participant_left",
  "match_reminder",
  "match_invitation",
  "match_confirmed",
  "match_result_reported",
  "team_invitation",
  "team_join_request",
  "recruitment_response",
  "challenge_received",
  "team_match_scheduled",
  "new_message",
  "tournament_update",
  "review_received",
] as const;
