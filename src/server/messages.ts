"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, str, uuid, type ActionState } from "@/lib/actions";
import { readPoint } from "@/lib/geo";
import { logger } from "@/lib/log";
import { MESSAGE_IMAGES, MESSAGE_VOICE, removeMessageFiles } from "@/lib/message-files";
import { thumbPathOf } from "@/lib/message-thumb";
import { isVideoSignature, isVideoType, MAX_POSTER_BYTES, MAX_VIDEO_BYTES, MESSAGE_VIDEOS, posterPathOf, VIDEO_PATH, videoExtensionOf } from "@/lib/message-video";
import { inspectAudio, inspectImage, randomFileName, UPLOAD_CACHE_SECONDS } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { drainPush, pushEnabled } from "@/server/push";

const MAX_VOICE_SECONDS = 300;
/** A picture's small copy is a few dozen kilobytes; anything much bigger isn't one. */
const MAX_THUMB_BYTES = 400 * 1024;

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
    const { error: uploadError } = await admin.storage.from(bucket).upload(path, file.bytes, { cacheControl: UPLOAD_CACHE_SECONDS, contentType: file.mime, upsert: false });
    if (uploadError) {
      logger.error("message_file_upload_failed", { bucket, message: uploadError.message.slice(0, 120) });
      return fail("upload_failed");
    }
    stored = { bucket, path };
    // The picture's small copy (made in the browser): optional, and never a reason for the message to fail.
    const thumb = image ? fileOf(fd, "image_thumb") : null;
    if (thumb && thumb.size <= MAX_THUMB_BYTES) {
      const small = await inspectImage(thumb);
      if (small.ok && small.mime === "image/jpeg") {
        const { error: thumbError } = await admin.storage
          .from(bucket)
          .upload(thumbPathOf(path), small.bytes, { cacheControl: UPLOAD_CACHE_SECONDS, contentType: "image/jpeg", upsert: false });
        if (thumbError) logger.warn("message_thumb_upload_failed", { message: thumbError.message.slice(0, 120) });
      }
    }
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
    if (stored) await createAdminClient()?.storage.from(stored.bucket).remove(image ? [stored.path, thumbPathOf(stored.path)] : [stored.path]);
    return fail(dbErrorCode(error, "send_message"));
  }
  revalidatePath("/[locale]/messages", "layout");
  // The others' phones hear of it now, once the answer is on its way (migration 0051).
  if (pushEnabled()) after(() => drainPush().then(() => undefined));
  return ok(undefined, data);
}

/**
 * Step one of sending a video (migration 0045): the database says whether this
 * member may send one here now (a member, not locked, within the hourly
 * limit); then a one-time link to upload the file straight to storage, to a
 * name chosen here in the conversation's folder. The site's own server never
 * carries the video: it refuses requests over 4.5 MB.
 */
export async function startVideoUpload(
  conversationId: string,
  file: { type: string; size: number },
): Promise<{ ok: true; path: string; url: string } | { ok: false; error: string }> {
  const conv = uuid.safeParse(conversationId);
  if (!conv.success || !file || typeof file.size !== "number") return { ok: false, error: "invalid" };
  if (!isVideoType(file.type)) return { ok: false, error: "video_type_not_allowed" };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "file_missing" };
  if (file.size > MAX_VIDEO_BYTES) return { ok: false, error: "video_too_large" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("begin_video_upload", { p_conversation_id: conv.data });
  if (error) return { ok: false, error: dbErrorCode(error, "begin_video_upload") };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "generic" };
  const path = `${conv.data}/${randomFileName(videoExtensionOf(file.type))}`;
  const { data, error: signError } = await admin.storage.from(MESSAGE_VIDEOS).createSignedUploadUrl(path);
  if (signError || !data?.signedUrl) {
    logger.error("message_video_upload_link_failed", { message: signError?.message.slice(0, 120) ?? "no link" });
    return { ok: false, error: "upload_failed" };
  }
  return { ok: true, path, url: data.signedUrl };
}

/**
 * The first bytes of a stored file: storage answers a range request with just
 * those. Never waits more than 8 seconds (an unanswered check fails safe: the
 * file is removed and the member asked to try again).
 */
async function firstBytes(url: string, count = 64): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=0-${count - 1}` }, signal: AbortSignal.timeout(8000) });
  // 206: the range; 200: a storage that ignores ranges (the whole file, cut here).
  if (res.status !== 206 && res.status !== 200) return new Uint8Array();
  return new Uint8Array(await res.arrayBuffer()).subarray(0, count);
}

/**
 * Step two: the uploaded video becomes a message. Its first bytes must be a
 * video's (not the name or type the browser gave); its still (a small JPEG
 * made in the browser) is stored beside it; then the database records the
 * message. Whatever fails, the uploaded files are removed again.
 */
export async function sendVideoMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const conv = uuid.safeParse(fd.get("conversation_id"));
  const path = String(fd.get("video_path") ?? "");
  const body = str(fd, "body") ?? "";
  if (!conv.success || !VIDEO_PATH.test(path) || !path.startsWith(`${conv.data}/`)) return fail("invalid");
  if (body.length > 2000) return fail("validation", { body: "too_long" });
  // Its length, when the browser could tell (shown on the video).
  const seconds = Math.round(Number(fd.get("video_seconds")));
  const length = Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : null;
  const supabase = await createClient();
  // RLS: the conversation is visible only to its members.
  const { data: member } = await supabase.from("conversations").select("id, is_locked").eq("id", conv.data).maybeSingle();
  if (!member) return fail("conversation_not_found");
  if (member.is_locked) return fail("conversation_locked");
  const admin = createAdminClient();
  if (!admin) return fail("generic");
  const storage = admin.storage.from(MESSAGE_VIDEOS);
  const discard = () => storage.remove([path, posterPathOf(path)]);
  const { data: link } = await storage.createSignedUrl(path, 60);
  const head = link?.signedUrl ? await firstBytes(link.signedUrl).catch(() => new Uint8Array()) : new Uint8Array();
  if (!isVideoSignature(head)) {
    await discard();
    return fail(head.length ? "video_type_not_allowed" : "upload_failed");
  }
  const poster = fileOf(fd, "poster");
  if (poster && poster.size <= MAX_POSTER_BYTES) {
    const still = await inspectImage(poster);
    if (still.ok && still.mime === "image/jpeg") {
      const { error: posterError } = await storage.upload(posterPathOf(path), still.bytes, {
        cacheControl: UPLOAD_CACHE_SECONDS,
        contentType: "image/jpeg",
        upsert: false,
      });
      // The still is a nicety: the video is sent without it.
      if (posterError) logger.warn("message_video_poster_failed", { message: posterError.message.slice(0, 120) });
    }
  }
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: conv.data,
    p_body: body,
    p_video_path: path,
    ...(length ? { p_video_seconds: length } : {}),
  });
  if (error) {
    await discard();
    return fail(dbErrorCode(error, "send_message"));
  }
  revalidatePath("/[locale]/messages", "layout");
  // The others' phones hear of it now, once the answer is on its way (migration 0051).
  if (pushEnabled()) after(() => drainPush().then(() => undefined));
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

const prefChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pin"), value: z.boolean() }),
  // 8 hours, a week, always (-1), or unmute (0).
  z.object({ kind: z.literal("mute"), hours: z.union([z.literal(0), z.literal(8), z.literal(168), z.literal(-1)]) }),
  z.object({ kind: z.literal("favorite"), value: z.boolean() }),
  z.object({ kind: z.literal("nickname"), value: z.string().max(40) }),
  z.object({ kind: z.literal("clear") }),
]);
export type ConversationPrefChange = z.infer<typeof prefChange>;

/**
 * The member's own settings for a conversation, from a long press on it in the
 * list (migration 0040): pin, mute, favourite, a nickname, or delete it for
 * themselves. The database checks they belong to the conversation.
 */
export async function updateConversationPref(conversationId: string, change: ConversationPrefChange): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = uuid.safeParse(conversationId);
  const parsed = prefChange.safeParse(change);
  if (!id.success || !parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const p_conversation_id = id.data;
  const supabase = await createClient();
  const { error } =
    v.kind === "pin"
      ? await supabase.rpc("pin_conversation", { p_conversation_id, p_pinned: v.value })
      : v.kind === "mute"
        ? await supabase.rpc("mute_conversation", { p_conversation_id, p_hours: v.hours })
        : v.kind === "favorite"
          ? await supabase.rpc("favorite_conversation", { p_conversation_id, p_favorite: v.value })
          : v.kind === "nickname"
            ? await supabase.rpc("set_conversation_nickname", { p_conversation_id, p_nickname: v.value.trim() })
            : await supabase.rpc("clear_conversation", { p_conversation_id });
  if (error) return { ok: false, error: dbErrorCode(error, `conversation_${v.kind}`) };
  revalidatePath("/[locale]/messages", "layout");
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
