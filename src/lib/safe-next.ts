const BASE = "https://same-site.invalid";

/**
 * Only same-site paths are allowed as where to go after signing in or opening
 * an e-mail link. The value is read the way a browser reads a link (which
 * drops tabs and line breaks, so "/\t/evil.com" is "//evil.com"), and anything
 * that would leave the site falls back.
 */
export function safeNext(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.length > 2048) return fallback;
  // Backslashes and control characters (tabs, line breaks, NUL…) have no place in a path we send people to.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
