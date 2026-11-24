"use server";

import { revalidatePath } from "next/cache";
import { dbErrorCode, fail, ok, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { isValidUsername, normalizeUsername, type UsernameStatus } from "@/lib/username";
import { usernameFree } from "@/lib/username-server";

/**
 * Whether a username is free, as the sign-up and settings forms ask while it is
 * typed (anyone may ask: usernames are public). «unknown» before migration 0041:
 * the form then says nothing and the database decides at sign-up.
 */
export async function checkUsername(raw: string): Promise<UsernameStatus> {
  if (typeof raw !== "string") return "invalid";
  const name = normalizeUsername(raw);
  if (!isValidUsername(name)) return "invalid";
  return usernameFree(await createClient(), name);
}

/** The member changes their username («الإعدادات»), up to 5 times a day. */
export async function setUsernameAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = fd.get("username");
  const name = typeof raw === "string" ? normalizeUsername(raw) : "";
  if (!isValidUsername(name)) return fail("validation", { username: "invalid_username" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_username", { p_username: name });
  if (error) {
    const code = dbErrorCode(error, "set_username");
    return code === "username_taken" || code === "invalid_username" ? fail("validation", { username: code }) : fail(code);
  }
  revalidatePath("/[locale]", "layout");
  return ok("username_saved");
}
