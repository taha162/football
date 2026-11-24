import "server-only";
import { thumbPathOf } from "@/lib/message-thumb";
import { MESSAGE_VIDEOS, posterPathOf } from "@/lib/message-video";
import { createAdminClient } from "@/lib/supabase/admin";

export const MESSAGE_IMAGES = "message-images";
export const MESSAGE_VOICE = "message-voice";

/**
 * Removes a message's picture (and its small copy), voice note and video (and its still) from storage. Call only after the
 * message stopped pointing at them (deleted or removed by a moderator). Not a
 * server action: callers decide which message, after their own checks.
 */
export async function removeMessageFiles(
  row: { image_path?: string | null; voice_path?: string | null; video_path?: string | null } | null | undefined,
): Promise<void> {
  if (!row) return;
  const admin = createAdminClient();
  if (!admin) return;
  if (row.image_path) await admin.storage.from(MESSAGE_IMAGES).remove([row.image_path, thumbPathOf(row.image_path)]);
  if (row.voice_path) await admin.storage.from(MESSAGE_VOICE).remove([row.voice_path]);
  if (row.video_path) await admin.storage.from(MESSAGE_VIDEOS).remove([row.video_path, posterPathOf(row.video_path)]);
}
