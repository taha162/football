#!/usr/bin/env node
/**
 * Performance budget for the JavaScript the site sends to browsers, checked
 * after `next build` (CI runs it on every pull request). It fails when the
 * compressed total grows past BUDGET_TOTAL_KB, or when a second chunk grows
 * past BUDGET_CHUNK_KB (the one allowed is the landing page's 3D stadium,
 * loaded only there). Raise a budget deliberately, in the same change that
 * needs it, never to make a build pass.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_TOTAL_KB = 760;
const BUDGET_CHUNK_KB = 110;
const ALLOWED_LARGE = 1;

const root = ".next/static";
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".js")) files.push(path);
  }
};
try {
  walk(root);
} catch {
  console.error(`No ${root}: run \`pnpm build\` first.`);
  process.exit(1);
}
const sizes = files.map((f) => ({ f, kb: gzipSync(readFileSync(f)).length / 1024 })).sort((a, b) => b.kb - a.kb);
const total = sizes.reduce((n, s) => n + s.kb, 0);
const large = sizes.filter((s) => s.kb > BUDGET_CHUNK_KB);
console.log(`Client JavaScript, gzipped: ${total.toFixed(0)} KB in ${sizes.length} files (budget ${BUDGET_TOTAL_KB} KB).`);
for (const s of sizes.slice(0, 5)) console.log(`  ${s.kb.toFixed(1).padStart(7)} KB  ${s.f}`);
let failed = false;
if (total > BUDGET_TOTAL_KB) {
  console.error(`Over budget: ${total.toFixed(0)} KB > ${BUDGET_TOTAL_KB} KB.`);
  failed = true;
}
if (large.length > ALLOWED_LARGE) {
  console.error(`${large.length} files over ${BUDGET_CHUNK_KB} KB (allowed: ${ALLOWED_LARGE}, the 3D stadium).`);
  failed = true;
}
process.exit(failed ? 1 : 0);
