import { describe, expect, it } from "vitest";
import { admin, createMatch, createUser, rpc, rpcRows } from "./helpers";

type HeaderState = { messages: number; notifications: number; manages_venues: boolean; manages_tournaments: boolean };

/**
 * Migration 0035: the header's numbers in one request (header_state()), and
 * unread counts that stop at 100.
 */
describe("header_state: the header's numbers in one request", () => {
  it("counts unread messages from others, and the bell without new-message notifications", async () => {
    const [me, friend] = [await createUser("Header me"), await createUser("Header friend")];
    const conv = await rpc<string>(friend, "start_direct_conversation", { p_user_id: me });
    for (const body of ["one", "two", "three"]) await rpc(friend, "send_message", { p_conversation_id: conv, p_body: body });
    await rpc(me, "send_message", { p_conversation_id: conv, p_body: "mine is never unread" });
    // A message only counts after my last read: sending marked it read, so the friend writes again.
    await rpc(friend, "send_message", { p_conversation_id: conv, p_body: "four" });
    await admin("insert into public.notifications (user_id, type, payload) values ($1, 'match_joined', '{}'), ($1, 'new_message', '{}')", [me]);

    const state = await rpc<HeaderState>(me, "header_state");
    expect(state.messages).toBe(1);
    // match_joined counts; new_message is a red dot on «الرسائل», not news for the bell.
    expect(state.notifications).toBe(1 + Number((await admin<{ n: string }>(
      "select count(*)::text as n from public.notifications where user_id = $1 and read_at is null and type not in ('new_message', 'match_joined')", [me]))[0].n));
    expect(state.manages_venues).toBe(false);
    expect(state.manages_tournaments).toBe(false);

    await rpc(me, "mark_conversation_read", { p_conversation_id: conv });
    expect((await rpc<HeaderState>(me, "header_state")).messages).toBe(0);
  });

  it("stops counting at 100, here and in the list of conversations", async () => {
    const organizer = await createUser("Header busy org");
    const match = await createMatch(organizer);
    const conv = await rpc<string>(organizer, "entity_conversation_id", { p_kind: "match", p_entity_id: match });
    const other = await createUser("Header busy other");
    await admin(
      "insert into public.messages (conversation_id, sender_id, body) select $1, $2, 'busy ' || g from generate_series(1, 150) g",
      [conv, other],
    );
    await admin("update public.conversations set last_message_at = now() where id = $1", [conv]);
    expect((await rpc<HeaderState>(organizer, "header_state")).messages).toBe(100);
    expect((await rpc<{ messages: number }>(organizer, "unread_counts")).messages).toBe(100);
    const list = await rpcRows<{ conversation_id: string; unread_count: string }>(organizer, "my_conversations", { p_limit: 50 });
    expect(Number(list.find((c) => c.conversation_id === conv)?.unread_count)).toBe(100);
  });

  it("says whether the member staffs a venue or organizes a tournament, and tells a visitor nothing", async () => {
    const owner = await createUser("Header owner");
    await rpc(owner, "create_venue", { p_name: `Header venue ${Date.now()}`, p_city_id: (await admin<{ id: string }>("select id from public.cities limit 1"))[0].id });
    const state = await rpc<HeaderState>(owner, "header_state");
    expect(state.manages_venues).toBe(true);
    expect(state.manages_tournaments).toBe(false);
    expect(await rpc<HeaderState>(null, "header_state").catch((e: Error) => e.message)).toMatch(/permission denied/);
  });
});
