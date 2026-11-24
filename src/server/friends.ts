"use server";

import { revalidatePath } from "next/cache";
import { dbErrorCode, fail, ok, uuid, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { isValidUsername, normalizeUsername } from "@/lib/username";

/**
 * Friends, added by username (migration 0042). The database checks everything:
 * who may ask whom (no blocks, not oneself), who may answer, and how many
 * requests a day.
 */
function refresh() {
  revalidatePath("/[locale]/friends", "page");
  revalidatePath("/[locale]/players/[id]", "page");
}

export async function sendFriendRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = fd.get("username");
  const name = typeof raw === "string" ? normalizeUsername(raw) : "";
  if (!isValidUsername(name)) return fail("user_not_found");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_friend_request", { p_username: name });
  if (error) return fail(dbErrorCode(error, "send_friend_request"));
  refresh();
  return ok(data === "friends" ? "friend_added" : "friend_requested");
}

export async function respondFriendRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = uuid.safeParse(fd.get("user_id"));
  if (!user.success) return fail("invalid");
  const accept = fd.get("accept") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_friend_request", { p_user_id: user.data, p_accept: accept });
  if (error) return fail(dbErrorCode(error, "respond_friend_request"));
  refresh();
  return ok(accept ? "friend_added" : "friend_declined");
}

export async function cancelFriendRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = uuid.safeParse(fd.get("user_id"));
  if (!user.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_friend_request", { p_user_id: user.data });
  if (error) return fail(dbErrorCode(error, "cancel_friend_request"));
  refresh();
  return ok("friend_request_cancelled");
}

export async function removeFriendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = uuid.safeParse(fd.get("user_id"));
  if (!user.success) return fail("invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_friend", { p_user_id: user.data });
  if (error) return fail(dbErrorCode(error, "remove_friend"));
  refresh();
  return ok("friend_removed");
}
