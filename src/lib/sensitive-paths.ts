/**
 * Addresses only someone looking for leaked files asks for: dot-files and
 * dot-folders (.env, .git/config, .DS_Store) and backup, dump, log, key,
 * config and archive files, under any prefix (/ar/.env too). The site serves
 * none of them; the proxy answers them 404 before anything renders. Only
 * `/.well-known/` (a standard place for public files) is left alone.
 *
 * The proxy's matcher (src/proxy.ts) lists the same patterns, so these
 * requests reach the proxy even though it skips other addresses with a dot.
 */
const DOT_SEGMENT = /(?:^|\/)\.(?!well-known(?:\/|$))[^/]+/;
const RISKY_EXTENSION =
  /\.(?:env|sql|sqlite3?|db|bak|backup|old|orig|save|swp|dump|log|ini|conf|cfg|pem|key|crt|p12|pfx|zip|tar|gz|tgz|bz2|xz|7z|rar|toml|ya?ml)(?:$|[./~])/i;

export function isSensitivePath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape: judge it as written.
  }
  return DOT_SEGMENT.test(path) || RISKY_EXTENSION.test(path);
}
