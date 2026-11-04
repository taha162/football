"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, str, uuid, type ActionState } from "@/lib/actions";
import { readPoint } from "@/lib/geo";
import { logger } from "@/lib/log";
import { MESSAGE_IMAGES, MESSAGE_VOICE, removeMessageFiles } from "@/lib/message-files";
import { inspectAudio, inspectImage, randomFileName } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_VOICE_SECONDS = 300;

const fileOf = (fd: FormData, key: string): File | null => {
  const v = fd.get(key);
  return v instanceof File && v.size > 0 ? v : null;
};

/**
 * Sends text and/or one attachment: a picture, a location or a voice note.
 * Files are checked by their first bytes, stored in the private bucket under
 * the conversation's folder only after the sender is seen to belong to the
 * conversation, and removed again if the message can't be sent.
 */
export async function sendMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const conv = uuid.safeParse(fd.get("conversation_id"));
  const body = str(fd, "body") ?? "";
  const image = fileOf(fd, "image");
  const voice = fileOf(fd, "voice");
  const point = readPoint(fd.get("location_lat"), fd.get("location_lng"), fd.get("location_accuracy"));
  if (!conv.success || point === "invalid") return fail("invalid");
  if (body.length > 2000) return fail("validation", { body: "too_long" });
  const attachments = [image, voice, point].filter(Boolean).length;
  if (attachments > 1) return fail("invalid");
  if (!body && attachments === 0) return fail("validation", { body: "required" });
  const seconds = voice ? Math.ceil(Number(fd.get("voice_seconds"))) : null;
  if (voice && (!Number.isFinite(seconds) || seconds! < 1 || seconds! > MAX_VOICE_SECONDS)) return fail("invalid_voice");
  const supabase = await createClient();

  let stored: { bucket: string; path: string } | null = null;
  if (image || voice) {
    const file = image ? await inspectImage(image) : await inspectAudio(voice!);
    if (!file.ok) return fail(file.error);
    // RLS: the conversation is visible only to its members.
    const { data: member } = await supabase.from("conversations").select("id, is_locked").eq("id", conv.data).maybeSingle();
    if (!member) return fail("conversation_not_found");
    if (member.is_locked) return fail("conversation_locked");
    const admin = createAdminClient();
    if (!admin) return fail("generic");
    const bucket = image ? MESSAGE_IMAGES : MESSAGE_VOICE;
    const path = `${conv.data}/${randomFileName(file.ext)}`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(path, file.bytes, { contentType: file.mime, upsert: false });
    if (uploadError) {
      logger.error("message_file_upload_failed", { bucket, message: uploadError.message.slice(0, 120) });
      return fail("upload_failed");
    }
    stored = { bucket, path };
  }

  // Only what this message carries is sent, so plain text keeps working on a
  // database that hasn't had the newer columns added yet.
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: conv.data,
    p_body: body,
    ...(image && stored ? { p_image_path: stored.path } : {}),
    ...(voice && stored ? { p_voice_path: stored.path, p_voice_seconds: seconds! } : {}),
    ...(point ? { p_location_lat: point.lat, p_location_lng: point.lng, ...(point.accuracy !== null ? { p_location_accuracy: point.accuracy } : {}) } : {}),
  });
  if (error) {
    if (stored) await createAdminClient()?.storage.from(stored.bucket).remove([stored.path]);
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

/** The sender deletes their message: everyone then sees «رسالة محذوفة», and its files are removed. */
export async function deleteMessage(messageId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(messageId) || messageId < 1) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: before } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle();
  const { error } = await supabase.rpc("delete_message", { p_message_id: messageId });
  if (error) return { ok: false, error: dbErrorCode(error, "delete_message") };
  // The message no longer points at its files; remove them too.
  await removeMessageFiles(before);
  return { ok: true };
}

/** The sender corrects their message's text; it's then marked «معدّلة» for everyone. */
export async function editMessage(messageId: number, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(messageId) || messageId < 1 || typeof body !== "string") return { ok: false, error: "invalid" };
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) return { ok: false, error: "invalid_message" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_message", { p_message_id: messageId, p_body: text });
  if (error) return { ok: false, error: dbErrorCode(error, "edit_message") };
  return { ok: true };
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
