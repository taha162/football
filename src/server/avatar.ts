import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbErrorCode } from "@/lib/actions";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { inspectImage, isPubliclyServed, randomFileName, UPLOAD_CACHE_SECONDS } from "@/lib/storage";
import type { Database } from "@/lib/supabase/types";

/**
 * A member's new picture, as the member whose session `supabase` carries (the
 * site's cookies or the phone app's token): checked by its first bytes, stored
 * in their own folder (the storage rules allow no other), set on the profile,
 * and the old one removed. Shared by the site (server/profile.ts) and the app
 * (/api/app/avatar).
 */
export async function uploadAvatar(
  supabase: SupabaseClient<Database>,
  user: { id: string; avatarPath: string | null },
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; code: string }> {
  const img = await inspectImage(file);
  if (!img.ok) return { ok: false, code: img.error };
  const path = `${user.id}/${randomFileName(img.ext)}`;
  const { error: upErr } = await supabase.storage.from("avatars").upload(path, img.bytes, { cacheControl: UPLOAD_CACHE_SECONDS, contentType: img.mime, upsert: false });
  if (upErr) return { ok: false, code: "upload_failed" };
  if (!(await isPubliclyServed("avatars", path))) {
    await removeOldAvatar(user.id, path);
    logger.error("storage_not_public", { bucket: "avatars" });
    return { ok: false, code: "storage_not_public" };
  }
  const { error } = await supabase.rpc("set_my_avatar", { p_path: path });
  if (error) {
    await removeOldAvatar(user.id, path);
    return { ok: false, code: dbErrorCode(error, "set_my_avatar") };
  }
  await removeOldAvatar(user.id, user.avatarPath);
  return { ok: true, path };
}

/**
 * The picture a member replaced or removed. Storage lets a member delete only
 * what they can also list, and nobody lists the avatars folder (pictures are
 * served by their public address), so the server key removes it, and only from
 * the member's own folder.
 */
export async function removeOldAvatar(userId: string, path: string | null): Promise<void> {
  if (!path || !path.startsWith(`${userId}/`) || path.includes("..")) return;
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin.storage.from("avatars").remove([path]);
  if (error) logger.warn("avatar_remove_failed", { message: error.message.slice(0, 120) });
}
