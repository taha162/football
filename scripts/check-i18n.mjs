#!/usr/bin/env node
/**
 * i18n consistency check.
 *  1. ar.json and en.json must have exactly the same keys.
 *  2. Every static key used in source (t("key") on a translator bound with
 *     useTranslations/getTranslations("namespace")) must exist.
 *  3. Dynamic keys (t(`status.${x}`)) are reported as prefixes that must exist.
 * Exit code 1 on any problem. Run: node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const en = JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8"));
const ar = JSON.parse(readFileSync(join(root, "messages/ar.json"), "utf8"));

function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

const enKeys = flatten(en);
const arKeys = flatten(ar);
const problems = [];
for (const k of enKeys.keys()) if (!arKeys.has(k)) problems.push(`missing in ar.json: ${k}`);
for (const k of arKeys.keys()) if (!enKeys.has(k)) problems.push(`missing in en.json: ${k}`);

const has = (key) => enKeys.has(key) || [...enKeys.keys()].some((k) => k.startsWith(`${key}.`));

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(f) ? [p] : [];
  });
}

const bindRe = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([\w.]+)"|\{[^}]*namespace:\s*"([\w.]+)"[^}]*\}|`([\w.]+)\.\$\{[^`]+\}`)?\s*\)/g;
for (const file of walk(join(root, "src"))) {
  const src = readFileSync(file, "utf8");
  const bindings = [];
  for (const m of src.matchAll(bindRe)) bindings.push({ name: m[1], ns: m[2] ?? m[3] ?? (m[4] ? `${m[4]}.*` : "") });
  // A variable name may be bound to several namespaces in one file (e.g. `t` in
  // generateMetadata and in the page); a key passes if any binding resolves it.
  const byName = new Map();
  for (const { name, ns } of bindings) byName.set(name, [...(byName.get(name) ?? []), ns]);
  for (const [name, namespaces] of byName) {
    if (namespaces.some((ns) => ns.endsWith(".*"))) continue; // dynamic namespace (legal pages)
    const callRe = new RegExp(`(?<![\\w.])${name}(?:\\.rich|\\.raw|\\.has)?\\(\\s*(?:"([\\w.]+)"|\`([\\w.]*)\\$\\{)`, "g");
    for (const c of src.matchAll(callRe)) {
      if (c[0].includes(".has(")) continue;
      const keys = namespaces.map((ns) => (c[1] ? (ns ? `${ns}.${c[1]}` : c[1]) : `${ns ? `${ns}.` : ""}${c[2].replace(/\.$/, "")}`));
      if (!keys.some(has)) problems.push(`${relative(root, file)}: unknown key "${keys[0]}"`);
    }
  }
}

if (problems.length) {
  console.error([...new Set(problems)].join("\n"));
  console.error(`\n${new Set(problems).size} i18n problem(s).`);
  process.exitCode = 1;
} else {
  console.log(`i18n OK: ${enKeys.size} keys, ar/en in sync, all static keys resolved.`);
}
