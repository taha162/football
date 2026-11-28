/**
 * The phone app (mobile/: Capacitor, Google Play and the App Store) shows this
 * same site and adds "AlMalabApp/<version>" to its user agent. The site then
 * lays itself out for it: edge to edge, keeping clear of the status bar and the
 * notch. Presentation only: nothing about who may do what depends on it.
 */
export const APP_USER_AGENT_MARK = "AlMalabApp/";

export function isAppUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent?.includes(APP_USER_AGENT_MARK));
}

/** The app can receive notifications (iPhone; Android when built with Firebase): mobile/capacitor.config.ts. */
export function appCanPush(userAgent: string | null | undefined): boolean {
  return isAppUserAgent(userAgent) && /AlMalabApp\/\S+ Push\b/.test(userAgent ?? "");
}

/** In the browser: is this page open inside the phone app? (`<html data-app>`, set by the server.) */
export function inApp(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-app");
}
