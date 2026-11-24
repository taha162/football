import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc, rpcRows } from "./helpers";

const usernameOf = async (id: string) => (await admin<{ username: string }>("select username from public.profiles where id = $1", [id]))[0].username;
async function befriend(a: string, b: string) {
  await rpc(a, "send_friend_request", { p_username: await usernameOf(b) });
  await rpc(b, "respond_friend_request", { p_user_id: a, p_accept: true });
}
const seenBy = async (viewer: string, ids: string[]) =>
  Object.fromEntries((await rpcRows<{ user_id: string; last_seen_at: string }>(viewer, "last_seen", { p_user_ids: ids })).map((r) => [r.user_id, r.last_seen_at]));

/** Migration 0049: «نشط الآن» and «نشط قبل…». */
describe("activity status", () => {
  it("friends and people one talks with see when one was active; strangers don't", async () => {
    const [me, friend, chat, stranger] = [await createUser("Active me"), await createUser("Active friend"), await createUser("Active chat"), await createUser("Active stranger")];
    await befriend(me, friend);
    await rpc(chat, "start_direct_conversation", { p_user_id: me });
    await rpc(me, "touch_presence");
    const [{ at }] = await admin<{ at: string }>("select last_seen_at::text as at from public.user_presence where user_id = $1", [me]);
    expect(at).toBeTruthy();
    expect(Object.keys(await seenBy(friend, [me]))).toEqual([me]);
    expect(Object.keys(await seenBy(chat, [me]))).toEqual([me]);
    expect(await seenBy(stranger, [me])).toEqual({});
    // Asked by conversation (the list of conversations, a conversation's bar): only one's own, one-to-one.
    const [{ conversation_id: talk }] = await admin<{ conversation_id: string }>(
      "select a.conversation_id from public.conversation_members a join public.conversation_members b using (conversation_id) where a.user_id = $1 and b.user_id = $2",
      [chat, me],
    );
    expect(await rpcRows(chat, "last_seen_in", { p_conversation_ids: [talk] })).toEqual([{ conversation_id: talk, user_id: me, last_seen_at: expect.any(Date) }]);
    expect(await rpcRows(stranger, "last_seen_in", { p_conversation_ids: [talk] })).toEqual([]);
    expect(await rpcRows(me, "last_seen_in", { p_conversation_ids: [talk] })).toEqual([]);
    // Not one's own, and nothing for visitors.
    expect(await seenBy(me, [me])).toEqual({});
    expect(await errorOf(rpcRows(null, "last_seen", { p_user_ids: [me] }))).toMatch(/permission denied/);
  });

  it("written at most every 45 seconds; hiding it hides it from everyone; a block hides it too", async () => {
    const [me, friend] = [await createUser("Quiet me"), await createUser("Quiet friend")];
    await befriend(me, friend);
    await rpc(me, "touch_presence");
    const first = (await admin<{ at: string }>("select last_seen_at::text as at from public.user_presence where user_id = $1", [me]))[0].at;
    await rpc(me, "touch_presence");
    expect((await admin<{ at: string }>("select last_seen_at::text as at from public.user_presence where user_id = $1", [me]))[0].at).toBe(first);
    await admin("update public.user_presence set last_seen_at = now() - interval '2 minutes' where user_id = $1", [me]);
    await rpc(me, "touch_presence");
    expect((await admin<{ at: string }>("select last_seen_at::text as at from public.user_presence where user_id = $1", [me]))[0].at).not.toBe(first);

    expect(await rpc(me, "my_presence_hidden")).toBe(false);
    await rpc(me, "set_presence_hidden", { p_hidden: true });
    expect(await rpc(me, "my_presence_hidden")).toBe(true);
    expect(await seenBy(friend, [me])).toEqual({});
    await rpc(me, "set_presence_hidden", { p_hidden: false });
    expect(Object.keys(await seenBy(friend, [me]))).toEqual([me]);
    await rpc(friend, "start_direct_conversation", { p_user_id: me });
    const [{ conversation_id: talk }] = await admin<{ conversation_id: string }>(
      "select a.conversation_id from public.conversation_members a join public.conversation_members b using (conversation_id) where a.user_id = $1 and b.user_id = $2",
      [friend, me],
    );
    expect(await rpcRows(friend, "last_seen_in", { p_conversation_ids: [talk] })).toHaveLength(1);
    await rpc(friend, "block_user", { p_user_id: me });
    expect(await rpcRows(friend, "last_seen_in", { p_conversation_ids: [talk] })).toEqual([]);
    expect(await seenBy(friend, [me])).toEqual({});
    // A long list is cut to 100, not refused; and nobody reads the table directly.
    expect(await seenBy(friend, Array.from({ length: 150 }, () => me))).toEqual({});
    expect(await errorOf(asUser(friend, "select * from public.user_presence"))).toMatch(/permission denied/);
  });
});
