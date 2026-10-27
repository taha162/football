/**
 * Minimal structured logger. Emits one JSON object per line so logs can be
 * shipped to any aggregator. Never pass passwords, tokens, message bodies or
 * other personal content; keys matching REDACT are masked defensively.
 */
type Level = "debug" | "info" | "warn" | "error";

const REDACT = /pass(word)?|token|secret|authorization|cookie|key|body|email|phone/i;

function sanitize(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = REDACT.test(k) ? "[redacted]" : v;
  return out;
}

function emit(level: Level, event: string, meta?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(meta) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => emit("debug", event, meta),
  info: (event: string, meta?: Record<string, unknown>) => emit("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => emit("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => emit("error", event, meta),
};
