"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, str, uuid, type ActionState } from "@/lib/actions";
import { logger } from "@/lib/log";
import { inspectImage, randomFileName } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MESSAGE_IMAGES = "message-images";

/**
 * Sends text, a picture, or both. The picture is checked by its first bytes,
 * stored in the private bucket under the conversation's folder only after the
 * sender is seen to belong to the conversation, and removed again if the
 * message can't be sent.
 */
export async function sendMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const conv = uuid.safeParse(fd.get("conversation_id"));
  const body = str(fd, "body") ?? "";
  const file = fd.get("image");
  const hasImage = file instanceof File && file.size > 0;
  if (!conv.success) return fail("invalid");
  if (body.length > 2000) return fail("validation", { body: "too_long" });
  if (!body && !hasImage) return fail("validation", { body: "required" });
  const supabase = await createClient();

  let imagePath: string | null = null;
  if (hasImage) {
    const image = await inspectImage(file);
    if (!image.ok) return fail(image.error);
    // RLS: the conversation is visible only to its members.
    const { data: member } = await supabase.from("conversations").select("id, is_locked").eq("id", conv.data).maybeSingle();
    if (!member) return fail("conversation_not_found");
    if (member.is_locked) return fail("conversation_locked");
    const admin = createAdminClient();
    if (!admin) return fail("generic");
    imagePath = `${conv.data}/${randomFileName(image.ext)}`;
    const { error: uploadError } = await admin.storage.from(MESSAGE_IMAGES).upload(imagePath, image.bytes, { contentType: image.mime, upsert: false });
    if (uploadError) {
      logger.error("message_image_upload_failed", { message: uploadError.message.slice(0, 120) });
      return fail("upload_failed");
    }
  }

  const { data, error } = await supabase.rpc("send_message", { p_conversation_id: conv.data, p_body: body, p_image_path: imagePath ?? undefined });
  if (error) {
    if (imagePath) await createAdminClient()?.storage.from(MESSAGE_IMAGES).remove([imagePath]);
    return fail(dbErrorCode(error, "send_message"));
  }
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
  const { data: before } = await supabase.from("messages").select("image_path").eq("id", id).maybeSingle();
  const { error } = await supabase.rpc("delete_message", { p_message_id: id });
  if (error) return fail(dbErrorCode(error, "delete_message"));
  // The message no longer points at its picture; remove the file too.
  if (before?.image_path) await createAdminClient()?.storage.from(MESSAGE_IMAGES).remove([before.image_path]);
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
