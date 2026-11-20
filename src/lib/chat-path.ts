/** A single conversation (/messages/<id>): it fills the screen, without the site's header and bottom bar. */
export function isConversationPath(pathname: string | null | undefined): boolean {
  return /^\/messages\/[^/]+\/?$/.test(pathname ?? "");
}
