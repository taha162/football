import { supabase } from "./supabase";
import { dbCode } from "./errors";

/** Where the member stands with someone (the site's friend_relation). */
export type Relation = "none" | "friend" | "requested" | "incoming" | "self" | "blocked";

/** Asking, answering and ending a friendship; each returns an error code or null (the database decides). */
export async function friendAction(kind: "add" | "accept" | "decline" | "cancel" | "remove", target: { id: string; username?: string | null }): Promise<string | null> {
  const db = supabase();
  const { error } =
    kind === "add"
      ? await db.rpc("send_friend_request", { p_username: target.username ?? "" })
      : kind === "accept" || kind === "decline"
        ? await db.rpc("respond_friend_request", { p_user_id: target.id, p_accept: kind === "accept" })
        : kind === "cancel"
          ? await db.rpc("cancel_friend_request", { p_user_id: target.id })
          : await db.rpc("remove_friend", { p_user_id: target.id });
  return error ? dbCode(error) : null;
}

/** A one-to-one conversation with someone (made once, then reused). */
export async function directConversation(userId: string): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase().rpc("start_direct_conversation", { p_user_id: userId });
  return error ? { error: dbCode(error) } : { id: data as string };
}
