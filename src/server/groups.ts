"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, uuid, type ActionState } from "@/lib/actions";
import { logger } from "@/lib/log";
import { inspectImage, isPubliclyServed, randomFileName, UPLOAD_CACHE_SECONDS } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Group conversations (migrations 0043–0044). The database decides everything
 * that matters: who may add whom (friends only), who is an admin, how many
 * members and new groups. These only read the form and say what happened.
 */

const MAX_NAME = 60;

/** The group's name as the database stores it: spaces and line breaks become single spaces. */
function groupName(fd: FormData): string | null {
  const raw = fd.get("title");
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return name.length >= 1 && [...name].length <= MAX_NAME ? name : null;
}

/** The ticked friends («member» boxes), each once. */
function memberIds(fd: FormData): string[] {
  return [...new Set(fd.getAll("member").filter((v): v is string => typeof v === "string" && uuid.safeParse(v).success))];
}

async function goTo(href: string) {
  const l = await getLocale();
  redirect({ href, locale: isLocale(l) ? l : "ar" });
}

function refresh() {
  revalidatePath("/[locale]/messages", "layout");
}

export async function createGroupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const title = groupName(fd);
  if (!title) return fail("validation", { title: "invalid_group_name" });
  const members = memberIds(fd);
  if (!members.length) return fail("group_needs_members");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_group", { p_title: title, p_member_ids: members });
  if (error) return fail(dbErrorCode(error, "create_group"));
  refresh();
  await goTo(`/messages/${data as string}`);
  return ok();
}

export async function addGroupMembersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const group = uuid.safeParse(fd.get("conversation_id"));
  if (!group.success) return fail("invalid");
  const members = memberIds(fd);
  if (!members.length) return fail("group_needs_members");
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_group_members", { p_conversation_id: group.data, p_member_ids: members });
  if (error) return fail(dbErrorCode(error, "add_group_members"));
  refresh();
  return ok("group_members_added");
}

export async function removeGroupMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const group = uuid.safeParse(fd.get("conversation_id"));
  const user = uuid.safeParse(fd.get("user_id"));
  if (!group.success || !user.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_group_member", { p_conversation_id: group.data, p_user_id: user.data });
  if (error) return fail(dbErrorCode(error, "remove_group_member"));
  refresh();
  return ok("group_member_removed");
}

export async function setGroupAdminAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const group = uuid.safeParse(fd.get("conversation_id"));
  const user = uuid.safeParse(fd.get("user_id"));
  if (!group.success || !user.success) return fail("invalid");
  const makeAdmin = fd.get("admin") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_admin", { p_conversation_id: group.data, p_user_id: user.data, p_admin: makeAdmin });
  if (error) return fail(dbErrorCode(error, "set_group_admin"));
  refresh();
  return ok(makeAdmin ? "group_admin_added" : "group_admin_removed");
}

export async function renameGroupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const group = uuid.safeParse(fd.get("conversation_id"));
  if (!group.success) return fail("invalid");
  const title = groupName(fd);
  if (!title) return fail("validation", { title: "invalid_group_name" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("rename_group", { p_conversation_id: group.data, p_title: title });
  if (error) return fail(dbErrorCode(error, "rename_group"));
  refresh();
  return ok("group_renamed");
}

export async function leaveGroupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const group = uuid.safeParse(fd.get("conversation_id"));
  if (!group.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_group", { p_conversation_id: group.data });
  if (error) return fail(dbErrorCode(error, "leave_group"));
  refresh();
  await goTo("/messages");
  return ok();
}

const GROUP_PHOTOS = "group-photos";

/** Whether the signed-in member is an admin of the group (RLS: only its members see its members). */
async function isGroupAdmin(supabase: Awaited<ReturnType<typeof createClient>>, group: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data } = await supabase.from("conversation_members").select("role").eq("conversation_id", group).eq("user_id", auth.user.id).maybeSingle();
  return (data as { role?: string } | null)?.role === "admin";
}

/**
 * Admins: the group's photo (migration 0048). Checked by its first bytes, stored
 * by the server in the group's folder, then set by the database, which checks
 * the admin again; the photo it replaced is removed.
 */
export async function setGroupPhotoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const group = uuid.safeParse(fd.get("conversation_id"));
  if (!group.success) return fail("invalid");
  const file = fd.get("photo");
  if (!(file instanceof File) || file.size === 0) return fail("file_missing");
  const img = await inspectImage(file);
  if (!img.ok) return fail(img.error);
  const supabase = await createClient();
  if (!(await isGroupAdmin(supabase, group.data))) return fail("not_group_admin");
  const admin = createAdminClient();
  if (!admin) return fail("generic");
  const storage = admin.storage.from(GROUP_PHOTOS);
  const path = `${group.data}/${randomFileName(img.ext)}`;
  const { error: upError } = await storage.upload(path, img.bytes, { cacheControl: UPLOAD_CACHE_SECONDS, contentType: img.mime, upsert: false });
  if (upError) {
    // Before migration 0048 there is no such bucket.
    if (/bucket not found/i.test(upError.message)) return fail("feature_not_ready");
    logger.error("group_photo_upload_failed", { message: upError.message.slice(0, 120) });
    return fail("upload_failed");
  }
  if (!(await isPubliclyServed(GROUP_PHOTOS, path))) {
    await storage.remove([path]);
    logger.error("storage_not_public", { bucket: GROUP_PHOTOS });
    return fail("storage_not_public");
  }
  const { data: previous, error } = await supabase.rpc("set_group_photo", { p_conversation_id: group.data, p_path: path });
  if (error) {
    await storage.remove([path]);
    return fail(dbErrorCode(error, "set_group_photo"));
  }
  if (typeof previous === "string" && previous) await storage.remove([previous]);
  refresh();
  return ok("group_photo_updated");
}

/** Admins: no photo any more. */
export async function removeGroupPhotoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const group = uuid.safeParse(fd.get("conversation_id"));
  if (!group.success) return fail("invalid");
  const supabase = await createClient();
  // The generated types don't model nullable arguments; null removes the photo.
  const { data: previous, error } = await supabase.rpc("set_group_photo", { p_conversation_id: group.data, p_path: null as unknown as string });
  if (error) return fail(dbErrorCode(error, "set_group_photo"));
  if (typeof previous === "string" && previous) await createAdminClient()?.storage.from(GROUP_PHOTOS).remove([previous]);
  refresh();
  return ok("group_photo_removed");
}
