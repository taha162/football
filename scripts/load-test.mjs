#!/usr/bin/env node
/**
 * Load test: requests pages at rising numbers of simultaneous visitors and
 * reports requests per second, response times (median, 95th and 99th
 * percentile) and failures for each step. No dependencies (Node 20+).
 *
 *   node scripts/load-test.mjs --base http://localhost:3000 --seconds 20 --levels 10,50,100 \
 *     --paths /ar,/ar/matches,/ar/venues [--cookie "name=value; ..."]
 *
 * Point it at your own deployment (a preview, or production at a quiet hour):
 * it creates real load. Every request is a GET; nothing is written.
 */
import { performance } from "node:perf_hooks";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const base = (args.base ?? "http://localhost:3000").replace(/\/$/, "");
const seconds = Number(args.seconds ?? 20);
const levels = String(args.levels ?? "10,50,100").split(",").map(Number);
const paths = String(args.paths ?? "/ar,/ar/matches,/ar/venues,/api/health").split(",");
const cookie = args.cookie ?? "";

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function step(concurrency) {
  const times = [];
  let failed = 0;
  const statuses = new Map();
  const stopAt = performance.now() + seconds * 1000;
  let next = 0;
  const worker = async () => {
    while (performance.now() < stopAt) {
      const path = paths[next++ % paths.length];
      const t0 = performance.now();
      try {
        const res = await fetch(base + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
        await res.arrayBuffer();
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        if (res.status >= 500) failed++;
      } catch {
        failed++;
      }
      times.push(performance.now() - t0);
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  return {
    concurrency,
    requests: times.length,
    rps: Math.round(times.length / elapsed),
    p50: Math.round(pct(times, 50)),
    p95: Math.round(pct(times, 95)),
    p99: Math.round(pct(times, 99)),
    failed,
    statuses: Object.fromEntries(statuses),
  };
}

console.log(`Load test: ${base}, ${seconds}s per step, paths: ${paths.join(" ")}${cookie ? " (signed in)" : ""}`);
console.log("visitors | requests | req/s | median ms | p95 ms | p99 ms | failed | statuses");
for (const level of levels) {
  const r = await step(level);
  console.log(
    `${String(r.concurrency).padStart(8)} | ${String(r.requests).padStart(8)} | ${String(r.rps).padStart(5)} | ${String(r.p50).padStart(9)} | ${String(r.p95).padStart(6)} | ${String(r.p99).padStart(6)} | ${String(r.failed).padStart(6)} | ${JSON.stringify(r.statuses)}`,
  );
}
