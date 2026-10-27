"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, str, uuid, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

export async function sendMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const conv = uuid.safeParse(fd.get("conversation_id"));
  const body = str(fd, "body");
  if (!conv.success) return fail("invalid");
  if (!body || body.length > 2000) return fail("validation", { body: body ? "too_long" : "required" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_message", { p_conversation_id: conv.data, p_body: body });
  if (error) return fail(dbErrorCode(error, "send_message"));
  revalidatePath("/[locale]/messages", "layout");
  return ok(undefined, data);
}

export async function markConversationReadAction(conversationId: string): Promise<void> {
  if (!uuid.safeParse(conversationId).success) return;
  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
}

export async function deleteMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = Number(fd.get("message_id"));
  if (!Number.isSafeInteger(id)) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_message", { p_message_id: id });
  if (error) return fail(dbErrorCode(error, "delete_message"));
  revalidatePath("/[locale]/messages", "layout");
  return ok("message_deleted");
}

export async function startDirectConversationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = uuid.safeParse(fd.get("user_id"));
  if (!user.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_direct_conversation", { p_user_id: user.data });
  if (error) return fail(dbErrorCode(error, "start_direct_conversation"));
  const l = await getLocale();
  redirect({ href: `/messages/${data as string}`, locale: isLocale(l) ? l : "ar" });
  return ok();
}
