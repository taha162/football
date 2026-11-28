import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbErrorCode } from "@/lib/actions";
import { logger } from "@/lib/log";
import { DELETE_WORD } from "@/lib/member-deletion";
import { passwordMatches } from "@/lib/password-check";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { accountTag, allowed, buckets, countFailure } from "@/lib/throttle";
import { memberVideoFiles, removeMemberFiles, type MemberFiles } from "@/server/member-files";

export type Outcome = { ok: true } | { ok: false; code: string; field?: { name: string; error: string } };

/**
 * The account's password, with the sign-in limits: wrong guesses here count
 * like wrong sign-ins. Used before anything that would hand the account to
 * someone else, or delete it.
 */
export async function checkAccountPassword(accountEmail: string, password: string, fieldName = "current_password"): Promise<Outcome> {
  if (!password) return { ok: false, code: "validation", field: { name: fieldName, error: "required" } };
  const limits = await buckets(["signinDevice"], [["signinAccount", accountEmail]]);
  if (!(await allowed(limits, accountEmail))) return { ok: false, code: "too_many_attempts" };
  if (await passwordMatches(accountEmail, password)) return { ok: true };
  logger.warn("account_change_wrong_password", { account: accountTag(accountEmail) });
  await countFailure(limits, accountEmail);
  return { ok: false, code: "validation", field: { name: fieldName, error: "wrong_password" } };
}

/**
 * A member deletes their own account (migration 0050): the word «حذف» and the
 * password; then the server key allows one deletion for 5 minutes, and the
 * deletion runs as the member (`supabase`: their session, from the site's
 * cookies or the app's token), so the database also asks for the second step
 * when they have one and refuses an admin of the site or a venue's owner.
 * Their files are then removed. Signing out is the caller's.
 */
export async function deleteOwnAccount(
  supabase: SupabaseClient<Database>,
  user: { id: string; email: string },
  input: { confirm: string; password: string; reason: string },
): Promise<Outcome> {
  if (input.confirm.trim() !== DELETE_WORD) return { ok: false, code: "validation", field: { name: "confirm", error: "delete_word" } };
  // What stops it is said before the password is even checked (the database checks again).
  const { data: preview, error: previewError } = await supabase.rpc("my_account_deletion_preview");
  if (previewError) return { ok: false, code: dbErrorCode(previewError, "my_account_deletion_preview") };
  const blockers = (preview ?? {}) as { admin?: boolean; owns_venues?: string[] };
  if (blockers.admin) return { ok: false, code: "admin_account" };
  if (blockers.owns_venues?.length) return { ok: false, code: "owns_venue" };
  const password = await checkAccountPassword(user.email, input.password);
  if (!password.ok) return password;
  const service = createAdminClient();
  if (!service) {
    logger.error("account_delete_failed", { hint: "SUPABASE_SERVICE_ROLE_KEY is not set" });
    return { ok: false, code: "generic" };
  }
  const { error: allowError } = await service.rpc("allow_account_deletion", { p_user_id: user.id });
  if (allowError) return { ok: false, code: dbErrorCode(allowError, "allow_account_deletion") };
  // Their videos (and stills): read first, as the deletion takes their messages with it.
  const videos = await memberVideoFiles(user.id);
  const reason = input.reason.trim().slice(0, 500);
  const { data, error } = await supabase.rpc("delete_my_account", { p_reason: reason || undefined });
  if (error) return { ok: false, code: dbErrorCode(error, "delete_my_account") };
  const left = await removeMemberFiles(((data ?? {}) as { files?: MemberFiles }).files ?? {}, videos);
  logger.info("account_self_deleted", { user: user.id, files_left: left });
  if (left > 0) logger.error("account_files_left", { user: user.id, count: left });
  return { ok: true };
}
