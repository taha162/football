import texts from "./site-texts.json";

type Tree = { [key: string]: string | Tree };

/**
 * One of the site's Arabic texts (scripts/sync-texts.mjs), by its path
 * ("booking.freeNone"), with its {placeholders} filled in.
 */
export function st(path: string, args: Record<string, string | number> = {}): string {
  let node: string | Tree | undefined = texts as unknown as Tree;
  for (const key of path.split(".")) node = typeof node === "object" ? node[key] : undefined;
  const text = typeof node === "string" ? node : path;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (k in args ? String(args[k]) : `{${k}}`));
}
