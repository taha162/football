import { describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, errorOf, mosul, notificationsOf, rpc, rpcRows } from "./helpers";

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

describe("editing and deleting a message", () => {
  const messageRow = async (id: number) =>
    (await admin<{ body: string; edited_at: Date | null; deleted_at: Date | null }>("select body, edited_at, deleted_at from public.messages where id = $1", [id]))[0];

  it("lets only the sender edit the text, marks it edited, and keeps what a report saw", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const id = Number(await rpc<string>(a, "send_message", { p_conversation_id: conv, p_body: "Kick-off at 8" }));

    // A report keeps the text as it was when reported.
    await rpc(b, "create_report", { p_target_type: "message", p_target_id: String(id), p_category: "spam" });

    expect(await errorOf(rpc(b, "edit_message", { p_message_id: id, p_body: "hijacked" }))).toBe("message_not_found");
    expect(await errorOf(rpc(a, "edit_message", { p_message_id: id, p_body: "   " }))).toBe("invalid_message");
    expect(await errorOf(rpc(a, "edit_message", { p_message_id: id, p_body: "x".repeat(2001) }))).toBe("invalid_message");

    // The same text changes nothing.
    await rpc(a, "edit_message", { p_message_id: id, p_body: " Kick-off at 8 " });
    expect((await messageRow(id)).edited_at).toBeNull();

    await rpc(a, "edit_message", { p_message_id: id, p_body: "Kick-off at 9" });
    const edited = await messageRow(id);
    expect(edited.body).toBe("Kick-off at 9");
    expect(edited.edited_at).not.toBeNull();
    // The other member reads the edit.
    expect(await asUser(b, "select body, edited_at is not null as edited from public.messages where id = $1", [id])).toEqual([{ body: "Kick-off at 9", edited: true }]);
    const [report] = await admin<{ snapshot: { body?: string } }>("select snapshot from public.reports where target_type = 'message' and target_id = $1", [String(id)]);
    expect(report.snapshot.body).toBe("Kick-off at 8");
  });

  it("can't edit a deleted message, a call's record, or once the conversation is closed to them", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const gone = Number(await rpc<string>(a, "send_message", { p_conversation_id: conv, p_body: "oops" }));
    await rpc(a, "delete_message", { p_message_id: gone });
    expect(await messageRow(gone)).toMatchObject({ body: "[deleted]" });
    expect(await errorOf(rpc(a, "edit_message", { p_message_id: gone, p_body: "back" }))).toBe("message_not_found");

    const [call] = await admin<{ id: string }>(
      "insert into public.messages (conversation_id, sender_id, body, call_outcome) values ($1, $2, '', 'missed') returning id",
      [conv, a],
    );
    expect(await errorOf(rpc(a, "edit_message", { p_message_id: Number(call.id), p_body: "no call" }))).toBe("message_not_found");

    const kept = Number(await rpc<string>(a, "send_message", { p_conversation_id: conv, p_body: "see you" }));
    await rpc(b, "block_user", { p_user_id: a });
    expect(await errorOf(rpc(a, "edit_message", { p_message_id: kept, p_body: "changed" }))).toBe("user_blocked");
    // Deleting your own message stays possible.
    await rpc(a, "delete_message", { p_message_id: kept });
    expect((await messageRow(kept)).deleted_at).not.toBeNull();
  });
});
