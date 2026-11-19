import { describe, expect, it } from "vitest";
import { admin, asUser, createMatch, createUser, rpc } from "./helpers";

/**
 * Migration 0033: «شوهدت» between two people (each may read when the other
 * last read their conversation), and who may use a conversation's typing
 * channel ("typing:<conversation id>", a private realtime broadcast topic).
 */
describe("conversations: seen and typing", () => {
  it("in a one-to-one conversation each member sees when the other read it; nobody else does", async () => {
    const [a, b, stranger] = [await createUser("Seen A"), await createUser("Seen B"), await createUser("Stranger")];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    await rpc(a, "send_message", { p_conversation_id: conv, p_body: "hi" });
    await rpc(b, "mark_conversation_read", { p_conversation_id: conv });

    const theirs = await asUser<{ last_read_at: Date }>(a, "select last_read_at from public.conversation_reads where conversation_id = $1 and user_id = $2", [conv, b]);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].last_read_at).toBeInstanceOf(Date);
    // B sees A's too (A read it when sending).
    expect(await asUser(b, "select 1 from public.conversation_reads where conversation_id = $1 and user_id = $2", [conv, a])).toHaveLength(1);
    // Nobody else: not a stranger, not a visitor.
    expect(await asUser(stranger, "select 1 from public.conversation_reads where conversation_id = $1", [conv])).toEqual([]);
    expect(await asUser(null, "select 1 from public.conversation_reads where conversation_id = $1", [conv])).toEqual([]);
  });

  it("in a group chat members still see only their own reads", async () => {
    const organizer = await createUser("Group org");
    const match = await createMatch(organizer);
    const player = await createUser("Group player");
    await rpc(player, "join_match", { p_match_id: match });
    const conv = await rpc<string>(player, "entity_conversation_id", { p_kind: "match", p_entity_id: match });
    await rpc(player, "mark_conversation_read", { p_conversation_id: conv });
    await rpc(organizer, "mark_conversation_read", { p_conversation_id: conv });
    const rows = await asUser<{ user_id: string }>(organizer, "select user_id from public.conversation_reads where conversation_id = $1", [conv]);
    expect(rows.map((r) => r.user_id)).toEqual([organizer]);
  });

  it("a conversation's typing channel is open to its members only", async () => {
    const [a, b, stranger] = [await createUser("Typing A"), await createUser("Typing B"), await createUser("Typing stranger")];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const allowed = async (actor: string, topic: string) =>
      (await asUser<{ ok: boolean }>(actor, "select private.typing_topic_allowed($1) as ok", [topic]))[0].ok;
    expect(await allowed(a, `typing:${conv}`)).toBe(true);
    expect(await allowed(b, `typing:${conv}`)).toBe(true);
    expect(await allowed(stranger, `typing:${conv}`)).toBe(false);
    // Only that exact shape of topic.
    expect(await allowed(a, `calls:${conv}`)).toBe(false);
    expect(await allowed(a, "typing:not-a-conversation")).toBe(false);
    expect(await allowed(a, `typing:${conv}x`)).toBe(false);

    // Leaving a group chat closes its channel too: access follows membership.
    const organizer = await createUser("Typing org");
    const match = await createMatch(organizer);
    await rpc(stranger, "join_match", { p_match_id: match });
    const group = await rpc<string>(stranger, "entity_conversation_id", { p_kind: "match", p_entity_id: match });
    expect(await allowed(stranger, `typing:${group}`)).toBe(true);
    await rpc(stranger, "leave_match", { p_match_id: match });
    expect(await allowed(stranger, `typing:${group}`)).toBe(false);
  });

  it("the typing rules sit on realtime messages, and reads reach the page live", async () => {
    const realtime = await admin<{ present: boolean }>("select to_regclass('realtime.messages') is not null as present");
    if (realtime[0].present) {
      const policies = await admin<{ policyname: string; cmd: string }>(
        "select policyname, cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'chat_typing_%' order by policyname",
      );
      expect(policies).toEqual([
        { policyname: "chat_typing_receive", cmd: "SELECT" },
        { policyname: "chat_typing_send", cmd: "INSERT" },
      ]);
    }
    const published = await admin("select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_reads'");
    expect(published).toHaveLength(1);
  });
});
