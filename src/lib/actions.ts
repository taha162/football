import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/log";

/**
 * Result returned by every server action. `error` is a stable code that the
 * client translates (messages.errors.<code>); details never leak to users.
 */
export type ActionState<T = unknown> =
  | { ok: true; message?: string; data?: T; at: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; at: number }
  | null;

export const ok = <T>(message?: string, data?: T): ActionState<T> => ({ ok: true, message, data, at: Date.now() });
export const fail = (error: string, fieldErrors?: Record<string, string>): ActionState<never> => ({
  ok: false,
  error,
  fieldErrors,
  at: Date.now(),
});

/** Error codes raised by database RPCs that are safe to show (translated). */
const KNOWN_CODE = /^[a-z][a-z0-9_]{2,60}$/;

export function dbErrorCode(error: Pick<PostgrestError, "message" | "code"> | null | undefined, context: string): string {
  if (!error) return "generic";
  if (error.code === "42501" && /permission denied/i.test(error.message)) return "forbidden";
  if (KNOWN_CODE.test(error.message)) return error.message;
  logger.error("rpc_failed", { context, code: error.code, message: error.message });
  return "generic";
}

/** Converts a zod error into field -> error-code entries. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message && KNOWN_CODE.test(issue.message) ? issue.message : "invalid";
  }
  return out;
}

// ---------------------------------------------------------------------------
// FormData helpers
// ---------------------------------------------------------------------------
export function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

export function strs(fd: FormData, key: string): string[] {
  return fd.getAll(key).filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

// Common schema pieces (messages are error codes).
export const uuid = z.string().uuid("invalid");
export const optionalUuid = z.string().uuid("invalid").optional();
export const intIn = (min: number, max: number) =>
  z.coerce.number().int("invalid").min(min, "out_of_range").max(max, "out_of_range");
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "invalid_datetime");
