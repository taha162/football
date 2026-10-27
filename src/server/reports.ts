"use server";

import { z } from "zod";
import { dbErrorCode, fail, ok, str, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

const TARGETS = ["user", "match", "team", "venue", "message", "review", "tournament", "booking"] as const;
const CATEGORIES = ["spam", "harassment", "fake_listing", "fraudulent_booking", "inappropriate_content", "unsafe_behavior", "other"] as const;

export async function createReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      target_type: z.enum(TARGETS),
      target_id: z.string().min(1).max(64),
      category: z.enum(CATEGORIES),
      details: z.string().max(1000, "too_long").optional(),
    })
    .safeParse({ target_type: str(fd, "target_type"), target_id: str(fd, "target_id"), category: str(fd, "category"), details: str(fd, "details") });
  if (!parsed.success) return fail("validation", { category: "required" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_report", {
    p_target_type: parsed.data.target_type,
    p_target_id: parsed.data.target_id,
    p_category: parsed.data.category,
    p_details: parsed.data.details,
  });
  if (error) return fail(dbErrorCode(error, "create_report"));
  return ok("report_submitted");
}
