/**
 * «نشط الآن»: active in the last 2½ minutes. An open tab in use says so about
 * once a minute (components/layout/live-refresh.tsx), so a member stays «now»
 * while they use the site, and turns «قبل دقيقتين» soon after they leave.
 */
export const ACTIVE_NOW_MS = 150_000;

/** How often an open tab in use says the member is active. */
export const PRESENCE_BEAT_MS = 60_000;

export function isActiveNow(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  return Boolean(lastSeenAt) && now - Date.parse(lastSeenAt!) < ACTIVE_NOW_MS;
}
