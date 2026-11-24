import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc, rpcRows } from "./helpers";

type Row = { conversation_id: string; pinned: boolean; muted: boolean; favorite: boolean; nickname: string | null; unread_count: string };
type HeaderState = { messages: number };

const list = (user: string) => rpcRows<Row>(user, "my_conversations", { p_limit: 100 });
const row = async (user: string, conv: string) => (await list(user)).find((c) => c.conversation_id === conv);

async function chat(a: string, b: string, body = "hello") {
  const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
  await rpc(a, "send_message", { p_conversation_id: conv, p_body: body });
  return conv;
}

/** Migration 0040: a member's own settings for a conversation (the long press in the list). */
describe("conversation settings: pin, mute, favourite, nickname, delete for me", () => {
  it("pins up to three, first in the list, latest pinned first", async () => {
    const me = await createUser("Pin me");
    const convs: string[] = [];
    for (let i = 0; i < 4; i++) convs.push(await chat(await createUser(`Pin friend ${i}`), me));
    await rpc(me, "pin_conversation", { p_conversation_id: convs[0], p_pinned: true });
    await rpc(me, "pin_conversation", { p_conversation_id: convs[1], p_pinned: true });
    await rpc(me, "pin_conversation", { p_conversation_id: convs[2], p_pinned: true });
    expect(await errorOf(rpc(me, "pin_conversation", { p_conversation_id: convs[3], p_pinned: true }))).toMatch(/pin_limit/);
    // Pinning one already pinned again is fine.
    await rpc(me, "pin_conversation", { p_conversation_id: convs[2], p_pinned: true });
    const ids = (await list(me)).map((c) => c.conversation_id);
    expect(ids.slice(0, 3)).toEqual([convs[2], convs[1], convs[0]]);
    expect((await row(me, convs[0]))?.pinned).toBe(true);
    await rpc(me, "pin_conversation", { p_conversation_id: convs[0], p_pinned: false });
    expect((await row(me, convs[0]))?.pinned).toBe(false);
    await rpc(me, "pin_conversation", { p_conversation_id: convs[3], p_pinned: true });
  });

  it("a muted conversation neither lights the messages dot nor notifies, until unmuted", async () => {
    const [me, friend] = [await createUser("Mute me"), await createUser("Mute friend")];
    const conv = await chat(friend, me, "before muting");
    expect((await rpc<HeaderState>(me, "header_state")).messages).toBe(1);
    await rpc(me, "mute_conversation", { p_conversation_id: conv, p_hours: 8 });
    expect((await row(me, conv))?.muted).toBe(true);
    expect((await rpc<HeaderState>(me, "header_state")).messages).toBe(0);
    // Still unread in the list itself.
    expect(Number((await row(me, conv))?.unread_count)).toBe(1);
    await admin("delete from public.notifications where user_id = $1", [me]);
    await admin("update public.messages set created_at = created_at - interval '20 minutes' where conversation_id = $1", [conv]);
    await rpc(friend, "send_message", { p_conversation_id: conv, p_body: "while muted" });
    expect(await admin("select 1 from public.notifications where user_id = $1 and type = 'new_message'", [me])).toHaveLength(0);
    await rpc(me, "mute_conversation", { p_conversation_id: conv, p_hours: 0 });
    expect((await row(me, conv))?.muted).toBe(false);
    expect((await rpc<HeaderState>(me, "header_state")).messages).toBe(2);
    // Always, until unmuted.
    await rpc(me, "mute_conversation", { p_conversation_id: conv, p_hours: -1 });
    expect((await admin<{ forever: boolean }>("select muted_until = 'infinity' as forever from public.conversation_prefs where user_id = $1 and conversation_id = $2", [me, conv]))[0].forever).toBe(true);
    expect(await errorOf(rpc(me, "mute_conversation", { p_conversation_id: conv, p_hours: -5 }))).toMatch(/invalid_duration/);
  });

  it("favourites and nicknames are the member's own", async () => {
    const [me, friend] = [await createUser("Nick me"), await createUser("Nick friend")];
    const conv = await chat(friend, me);
    await rpc(me, "favorite_conversation", { p_conversation_id: conv, p_favorite: true });
    await rpc(me, "set_conversation_nickname", { p_conversation_id: conv, p_nickname: "  أبو علي  " });
    expect(await row(me, conv)).toMatchObject({ favorite: true, nickname: "أبو علي" });
    // The friend's view is untouched.
    expect(await row(friend, conv)).toMatchObject({ favorite: false, nickname: null });
    expect(await asUser(friend, "select * from public.conversation_prefs where conversation_id = $1", [conv])).toHaveLength(0);
    expect(await errorOf(rpc(me, "set_conversation_nickname", { p_conversation_id: conv, p_nickname: "x".repeat(41) }))).toMatch(/invalid_nickname/);
    await rpc(me, "set_conversation_nickname", { p_conversation_id: conv, p_nickname: "" });
    expect((await row(me, conv))?.nickname).toBeNull();
  });

  it("delete hides the conversation for the member only, until the next message", async () => {
    const [me, friend] = [await createUser("Clear me"), await createUser("Clear friend")];
    const conv = await chat(friend, me, "old news");
    await rpc(me, "pin_conversation", { p_conversation_id: conv, p_pinned: true });
    await rpc(me, "clear_conversation", { p_conversation_id: conv });
    expect(await row(me, conv)).toBeUndefined();
    expect(await row(friend, conv)).toBeDefined();
    expect((await rpc<HeaderState>(me, "header_state")).messages).toBe(0);
    // Nothing was deleted.
    expect(await admin("select 1 from public.messages where conversation_id = $1", [conv])).toHaveLength(1);
    await rpc(friend, "send_message", { p_conversation_id: conv, p_body: "are you there?" });
    expect(await row(me, conv)).toMatchObject({ pinned: false, unread_count: "1" });
  });

  it("only members can change a conversation's settings, and visitors not at all", async () => {
    const [a, b, stranger] = [await createUser("Prefs a"), await createUser("Prefs b"), await createUser("Prefs stranger")];
    const conv = await chat(a, b);
    for (const [fn, args] of [
      ["pin_conversation", { p_pinned: true }],
      ["mute_conversation", { p_hours: 8 }],
      ["favorite_conversation", { p_favorite: true }],
      ["set_conversation_nickname", { p_nickname: "x" }],
      ["clear_conversation", {}],
    ] as const) {
      expect(await errorOf(rpc(stranger, fn, { p_conversation_id: conv, ...args }))).toMatch(/conversation_not_found/);
      expect(await errorOf(rpc(null, fn, { p_conversation_id: conv, ...args }))).toMatch(/permission denied/);
    }
    expect(await errorOf(asUser(a, "insert into public.conversation_prefs (user_id, conversation_id, favorite) values ($1, $2, true)", [a, conv]))).toMatch(/permission denied/);
  });
});
