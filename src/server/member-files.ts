import "server-only";
import { MESSAGE_VIDEOS, posterPathOf } from "@/lib/message-video";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A deleted member's files in Storage: an admin's deletion (Admin → Users →
 * «حذف نهائي») and the member's own (Settings → «حذف الحساب»). The database
 * deletes the account and says which files were theirs; these are then removed
 * with the server key.
 */

export const MEMBER_FILE_BUCKETS = ["avatars", "message-images", "message-voice"] as const;
export type MemberFiles = Partial<Record<(typeof MEMBER_FILE_BUCKETS)[number], string[]>>;

/**
 * The videos a member sent, with their stills (none before migration 0045),
 * read before the deletion takes their messages with it. Anything missed is
 * removed by the scheduled clean-up of videos no message points at.
 */
export async function memberVideoFiles(userId: string): Promise<string[]> {
  const service = createAdminClient();
  if (!service) return [];
  const paths: string[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await service.from("messages").select("video_path").eq("sender_id", userId).not("video_path", "is", null).range(from, from + 999);
    if (error || !data?.length) break;
    for (const row of data) if (row.video_path) paths.push(row.video_path, posterPathOf(row.video_path));
    if (data.length < 1000) break;
  }
  return paths;
}

/** Removes the files; returns how many couldn't be. */
export async function removeMemberFiles(files: MemberFiles, videos: string[]): Promise<number> {
  const storage = createAdminClient()?.storage;
  let left = 0;
  const removeAll = async (bucket: string, paths: string[]) => {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = storage ? await storage.from(bucket).remove(chunk) : { error: { message: "no_service_role" } };
      if (error) left += chunk.length;
    }
  };
  for (const bucket of MEMBER_FILE_BUCKETS) await removeAll(bucket, (files[bucket] ?? []).filter((p) => typeof p === "string" && p.length > 0));
  await removeAll(MESSAGE_VIDEOS, videos);
  return left;
}
