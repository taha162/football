import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbErrorCode, str, uuid } from "@/lib/actions";
import { readPoint } from "@/lib/geo";
import { logger } from "@/lib/log";
import { MESSAGE_IMAGES, MESSAGE_VOICE } from "@/lib/message-files";
import { thumbPathOf } from "@/lib/message-thumb";
import { inspectAudio, inspectImage, randomFileName, UPLOAD_CACHE_SECONDS } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

const MAX_VOICE_SECONDS = 300;
/** A picture's small copy is a few dozen kilobytes; anything much bigger isn't one. */
const MAX_THUMB_BYTES = 400 * 1024;

const fileOf = (fd: FormData, key: string): File | null => {
  const v = fd.get(key);
  return v instanceof File && v.size > 0 ? v : null;
};

export type Sent = { ok: true; id: number } | { ok: false; code: string; fields?: Record<string, string> };

/**
 * Sends text and/or one attachment: a picture (with its small copy), a
 * location or a voice note, as the member whose session `supabase` carries
 * (the site's cookies, or the phone app's token). Files are checked by their
 * first bytes, stored in the private bucket under the conversation's folder
 * only after the sender is seen to belong to it, and removed again if the
 * database refuses the message. Shared by the site (server/messages.ts) and
 * the app (/api/app/message).
 */
export async function sendMessage(supabase: SupabaseClient<Database>, fd: FormData): Promise<Sent> {
  const conv = uuid.safeParse(fd.get("conversation_id"));
  const body = str(fd, "body") ?? "";
  const image = fileOf(fd, "image");
  const voice = fileOf(fd, "voice");
  const point = readPoint(fd.get("location_lat"), fd.get("location_lng"), fd.get("location_accuracy"));
  if (!conv.success || point === "invalid") return { ok: false, code: "invalid" };
  if (body.length > 2000) return { ok: false, code: "validation", fields: { body: "too_long" } };
  const attachments = [image, voice, point].filter(Boolean).length;
  if (attachments > 1) return { ok: false, code: "invalid" };
  if (!body && attachments === 0) return { ok: false, code: "validation", fields: { body: "required" } };
  const seconds = voice ? Math.ceil(Number(fd.get("voice_seconds"))) : null;
  if (voice && (!Number.isFinite(seconds) || seconds! < 1 || seconds! > MAX_VOICE_SECONDS)) return { ok: false, code: "invalid_voice" };

  let stored: { bucket: string; path: string } | null = null;
  if (image || voice) {
    const file = image ? await inspectImage(image) : await inspectAudio(voice!);
    if (!file.ok) return { ok: false, code: file.error };
    // RLS: the conversation is visible only to its members.
    const { data: member } = await supabase.from("conversations").select("id, is_locked").eq("id", conv.data).maybeSingle();
    if (!member) return { ok: false, code: "conversation_not_found" };
    if (member.is_locked) return { ok: false, code: "conversation_locked" };
    const admin = createAdminClient();
    if (!admin) return { ok: false, code: "generic" };
    const bucket = image ? MESSAGE_IMAGES : MESSAGE_VOICE;
    const path = `${conv.data}/${randomFileName(file.ext)}`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(path, file.bytes, { cacheControl: UPLOAD_CACHE_SECONDS, contentType: file.mime, upsert: false });
    if (uploadError) {
      logger.error("message_file_upload_failed", { bucket, message: uploadError.message.slice(0, 120) });
      return { ok: false, code: "upload_failed" };
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
    return { ok: false, code: dbErrorCode(error, "send_message") };
  }
  return { ok: true, id: data as number };
}
