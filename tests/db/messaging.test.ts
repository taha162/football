import { describe, expect, it } from "vitest";
import { asUser, createMatch, createUser, errorOf, mosul, notificationsOf, rpc, rpcRows } from "./helpers";

describe("conversations", () => {
  it("match chat is limited to the organizer and confirmed participants, and access ends on leaving", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    const [player, stranger] = [await createUser(), await createUser()];
    await rpc(player, "join_match", { p_match_id: match });
    const conv = await rpc<string>(player, "entity_conversation_id", { p_kind: "match", p_entity_id: match });
    expect(conv).toBeTruthy();
    expect(await rpc(stranger, "entity_conversation_id", { p_kind: "match", p_entity_id: match })).toBeNull();

    await rpc(organizer, "send_message", { p_conversation_id: conv, p_body: "Bring white shirts" });
    expect(await asUser(player, "select body from public.messages where conversation_id = $1", [conv])).toHaveLength(1);
    expect(await asUser(stranger, "select body from public.messages where conversation_id = $1", [conv])).toEqual([]);
    expect(await errorOf(rpc(stranger, "send_message", { p_conversation_id: conv, p_body: "spam" }))).toBe("conversation_not_found");

    const list = await rpcRows<{ conversation_id: string; unread_count: string }>(player, "my_conversations");
    expect(list.find((c) => c.conversation_id === conv)?.unread_count).toBe("1");
    await rpc(player, "mark_conversation_read", { p_conversation_id: conv });
    const after = await rpcRows<{ conversation_id: string; unread_count: string }>(player, "my_conversations");
    expect(after.find((c) => c.conversation_id === conv)?.unread_count).toBe("0");

    await rpc(player, "leave_match", { p_match_id: match });
    expect(await asUser(player, "select body from public.messages where conversation_id = $1", [conv])).toEqual([]);
  });

  it("cancelled matches make the conversation read-only", async () => {
    const organizer = await createUser("Org");
    const match = await createMatch(organizer);
    const conv = await rpc<string>(organizer, "entity_conversation_id", { p_kind: "match", p_entity_id: match });
    await rpc(organizer, "cancel_match", { p_match_id: match });
    expect(await errorOf(rpc(organizer, "send_message", { p_conversation_id: conv, p_body: "hello?" }))).toBe("conversation_locked");
  });

  it("direct messages respect blocks, notify the recipient once per window and are rate limited", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    expect(await rpc<string>(b, "start_direct_conversation", { p_user_id: a })).toBe(conv);
    await rpc(a, "send_message", { p_conversation_id: conv, p_body: "hi" });
    await rpc(a, "send_message", { p_conversation_id: conv, p_body: "are you playing?" });
    expect(await notificationsOf(b, "new_message")).toHaveLength(1);

    await rpc(b, "block_user", { p_user_id: a });
    expect(await errorOf(rpc(a, "send_message", { p_conversation_id: conv, p_body: "hello" }))).toBe("user_blocked");
    await rpc(b, "unblock_user", { p_user_id: a });

    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) => rpc(a, "send_message", { p_conversation_id: conv, p_body: `m${i}` })),
    );
    expect(results.some((r) => r.status === "rejected" && (r.reason as Error).message === "rate_limited")).toBe(true);
  });

  it("team chat follows team membership", async () => {
    const captain = await createUser("Cap");
    const team = await rpc<string>(captain, "create_team", { p_name: `Chat FC ${captain.slice(0, 4)}`, p_city_id: await mosul() });
    const outsider = await createUser();
    const conv = await rpc<string>(captain, "entity_conversation_id", { p_kind: "team", p_entity_id: team });
    await rpc(captain, "send_message", { p_conversation_id: conv, p_body: "Training Friday" });
    expect(await asUser(outsider, "select * from public.messages where conversation_id = $1", [conv])).toEqual([]);
  });
});
