"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { dbErrorCode, fail, ok, uuid, type ActionState } from "@/lib/actions";
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
