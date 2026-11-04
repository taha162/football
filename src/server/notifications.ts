"use server";

import { z } from "zod";
import { uuid } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

/**
 * Opening the notifications page reads them: the notifications that were
 * unread when it was shown (not ones that arrived since) are marked read.
 * The page isn't re-rendered, so what was new stays visible for a moment.
 */
export async function markNotificationsSeen(ids: string[]): Promise<boolean> {
  const parsed = z.array(uuid).min(1).max(500).safeParse(ids);
  if (!parsed.success) return false;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: parsed.data });
  if (error) console.error("mark_notifications_read failed", error.message);
  return !error;
}
