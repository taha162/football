"use server";

import { revalidatePath } from "next/cache";
import { dbErrorCode, fail, ok, uuid, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationsReadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = fd.get("id");
  const ids = typeof id === "string" && uuid.safeParse(id).success ? [id] : undefined;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
  if (error) return fail(dbErrorCode(error, "mark_notifications_read"));
  revalidatePath("/", "layout");
  return ok(ids ? undefined : "all_read");
}
