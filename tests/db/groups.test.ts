import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, notificationsOf, rpc, rpcRows } from "./helpers";

const usernameOf = async (id: string) => (await admin<{ username: string }>("select username from public.profiles where id = $1", [id]))[0].username;
async function befriend(a: string, b: string) {
  await rpc(a, "send_friend_request", { p_username: await usernameOf(b) });
  await rpc(b, "respond_friend_request", { p_user_id: a, p_accept: true });
}
const rolesOf = async (group: string) =>
  Object.fromEntries(
    (await admin<{ user_id: string; role: string }>("select user_id, role from public.conversation_members where conversation_id = $1", [group])).map((r) => [r.user_id, r.role]),
  );
const canRead = async (user: string, group: string) => (await asUser(user, "select id from public.conversations where id = $1", [group])).length === 1;
const listed = async (user: string, group: string) =>
  (await rpcRows<{ conversation_id: string; kind: string; title: string }>(user, "my_conversations", { p_limit: 50 })).find((c) => c.conversation_id === group);

async function withSetting(key: string, value: string, fn: () => Promise<void>) {
  const [{ value: before }] = await admin<{ value: unknown }>("select value from public.platform_settings where key = $1", [key]);
  await admin("update public.platform_settings set value = $2::jsonb where key = $1", [key, value]);
  try {
    await fn();
  } finally {
    await admin("update public.platform_settings set value = $2::jsonb where key = $1", [key, JSON.stringify(before)]);
  }
}

/** Migrations 0043–0044: group conversations of friends, with admins. */
describe("groups", () => {
  it("a member makes a group of friends and is its admin; everyone in it sees it at once and can talk", async () => {
    const [a, b, c] = [await createUser("Group maker"), await createUser("Group b"), await createUser("Group c")];
    await befriend(a, b);
    await befriend(a, c);
    const group = await rpc<string>(a, "create_group", { p_title: "  Friday \n  five  ", p_member_ids: [b, c, a, b] });
    expect((await admin("select kind, title, created_by from public.conversations where id = $1", [group]))[0]).toMatchObject({ kind: "group", title: "Friday five", created_by: a });
    expect(await rolesOf(group)).toEqual({ [a]: "admin", [b]: "member", [c]: "member" });
    // In the list before anyone writes.
    expect(await listed(b, group)).toMatchObject({ kind: "group", title: "Friday five" });
    // Those added hear of it once, by name.
    const [notice] = await notificationsOf(b, "group_added");
    expect(notice.payload).toMatchObject({ conversation_id: group, group_name: "Friday five" });
    expect(await notificationsOf(a, "group_added")).toHaveLength(0);

    await rpc(b, "send_message", { p_conversation_id: group, p_body: "نلعب الجمعة؟" });
    expect(await asUser(c, "select body from public.messages where conversation_id = $1", [group])).toEqual([{ body: "نلعب الجمعة؟" }]);
    // Group messages light the messages tab, not the bell: no notification rows.
    expect(await notificationsOf(c, "new_message")).toHaveLength(0);
    expect(Number((await listed(c, group) as unknown as { unread_count: number }).unread_count)).toBe(1);
  });

  it("only friends can be added, and a group needs a name and someone else", async () => {
    const [a, b, stranger] = [await createUser("Picky a"), await createUser("Picky b"), await createUser("Picky stranger")];
    await befriend(a, b);
    expect(await errorOf(rpc(a, "create_group", { p_title: "Mixed", p_member_ids: [b, stranger] }))).toMatch(/not_friends/);
    expect(await errorOf(rpc(a, "create_group", { p_title: "Alone", p_member_ids: [a] }))).toMatch(/group_needs_members/);
    expect(await errorOf(rpc(a, "create_group", { p_title: "Nobody", p_member_ids: [] }))).toMatch(/group_needs_members/);
    expect(await errorOf(rpc(a, "create_group", { p_title: " \n ", p_member_ids: [b] }))).toMatch(/invalid_group_name/);
    expect(await errorOf(rpc(a, "create_group", { p_title: "x".repeat(61), p_member_ids: [b] }))).toMatch(/invalid_group_name/);
    const group = await rpc<string>(a, "create_group", { p_title: "Friends only", p_member_ids: [b] });
    expect(await errorOf(rpc(a, "add_group_members", { p_conversation_id: group, p_member_ids: [stranger] }))).toMatch(/not_friends/);

    // Someone outside sees and sends nothing.
    expect(await canRead(stranger, group)).toBe(false);
    expect(await asUser(stranger, "select id from public.messages where conversation_id = $1", [group])).toHaveLength(0);
    expect(await asUser(stranger, "select user_id from public.conversation_members where conversation_id = $1", [group])).toHaveLength(0);
    expect(await errorOf(rpc(stranger, "send_message", { p_conversation_id: group, p_body: "hi" }))).toMatch(/conversation_not_found/);
    expect(await errorOf(rpc(stranger, "leave_group", { p_conversation_id: group }))).toMatch(/conversation_not_found/);
  });

  it("admins add, remove, promote and rename; members can't; the one who made it stays", async () => {
    const [a, b, c, d] = [await createUser("Admin a"), await createUser("Admin b"), await createUser("Admin c"), await createUser("Admin d")];
    await befriend(a, b);
    await befriend(a, c);
    const group = await rpc<string>(a, "create_group", { p_title: "Five a side", p_member_ids: [b] });

    // A member asks for admin things.
    for (const [fn, args] of [
      ["add_group_members", { p_member_ids: [c] }],
      ["remove_group_member", { p_user_id: a }],
      ["set_group_admin", { p_user_id: b, p_admin: true }],
      ["rename_group", { p_title: "Mine now" }],
    ] as const) {
      expect(await errorOf(rpc(b, fn, { p_conversation_id: group, ...args }))).toMatch(/not_group_admin/);
    }

    expect(await rpc(a, "add_group_members", { p_conversation_id: group, p_member_ids: [c] })).toBe(1);
    expect(await rpc(a, "add_group_members", { p_conversation_id: group, p_member_ids: [c] })).toBe(0);
    await rpc(a, "set_group_admin", { p_conversation_id: group, p_user_id: b, p_admin: true });
    // b adds their own friends, not a's.
    expect(await errorOf(rpc(b, "add_group_members", { p_conversation_id: group, p_member_ids: [d] }))).toMatch(/not_friends/);
    await befriend(b, d);
    expect(await rpc(b, "add_group_members", { p_conversation_id: group, p_member_ids: [d] })).toBe(1);
    // The one who made it can't be removed or lose admin by others.
    expect(await errorOf(rpc(b, "remove_group_member", { p_conversation_id: group, p_user_id: a }))).toMatch(/group_creator/);
    expect(await errorOf(rpc(b, "set_group_admin", { p_conversation_id: group, p_user_id: a, p_admin: false }))).toMatch(/group_creator/);
    // Nobody changes or removes themselves this way (they leave instead).
    expect(await errorOf(rpc(a, "remove_group_member", { p_conversation_id: group, p_user_id: a }))).toMatch(/invalid/);
    expect(await errorOf(rpc(b, "set_group_admin", { p_conversation_id: group, p_user_id: b, p_admin: false }))).toMatch(/invalid/);

    await rpc(b, "rename_group", { p_conversation_id: group, p_title: "Five a side — Fridays" });
    expect((await listed(c, group))?.title).toBe("Five a side — Fridays");
    await rpc(b, "remove_group_member", { p_conversation_id: group, p_user_id: c });
    expect(await canRead(c, group)).toBe(false);
    expect(await errorOf(rpc(c, "send_message", { p_conversation_id: group, p_body: "still here?" }))).toMatch(/conversation_not_found/);
    expect(await errorOf(rpc(b, "remove_group_member", { p_conversation_id: group, p_user_id: c }))).toMatch(/member_not_found/);
    expect(await rolesOf(group)).toEqual({ [a]: "admin", [b]: "admin", [d]: "member" });
  });

  it("never without an admin: when the last one goes, the member there longest becomes one", async () => {
    const [a, b, c] = [await createUser("Leaver a"), await createUser("Leaver b"), await createUser("Leaver c")];
    await befriend(a, b);
    await befriend(a, c);
    const group = await rpc<string>(a, "create_group", { p_title: "Handover", p_member_ids: [b] });
    await admin("update public.conversation_members set created_at = created_at - interval '1 minute' where conversation_id = $1", [group]);
    await rpc(a, "add_group_members", { p_conversation_id: group, p_member_ids: [c] });
    await rpc(a, "pin_conversation", { p_conversation_id: group, p_pinned: true });

    await rpc(a, "leave_group", { p_conversation_id: group });
    expect(await canRead(a, group)).toBe(false);
    expect(await admin("select 1 from public.conversation_prefs where conversation_id = $1 and user_id = $2", [group, a])).toHaveLength(0);
    expect(await rolesOf(group)).toEqual({ [b]: "admin", [c]: "member" });

    // An account deleted: the same.
    await admin("delete from auth.users where id = $1", [b]);
    expect(await rolesOf(group)).toEqual({ [c]: "admin" });
    await rpc(c, "leave_group", { p_conversation_id: group });
    expect(await rolesOf(group)).toEqual({});
    // Not a way out of a one-to-one conversation.
    const [x, y] = [await createUser("Direct x"), await createUser("Direct y")];
    const direct = await rpc<string>(x, "start_direct_conversation", { p_user_id: y });
    expect(await errorOf(rpc(x, "leave_group", { p_conversation_id: direct }))).toMatch(/conversation_not_found/);
    expect(await canRead(x, direct)).toBe(true);
  });

  it("a group holds only so many members, and a member makes only so many groups a day", async () => {
    const [a, b, c, d] = [await createUser("Size a"), await createUser("Size b"), await createUser("Size c"), await createUser("Size d")];
    for (const f of [b, c, d]) await befriend(a, f);
    await withSetting("groups.max_members", "3", async () => {
      expect(await errorOf(rpc(a, "create_group", { p_title: "Too many", p_member_ids: [b, c, d] }))).toMatch(/group_full/);
      const group = await rpc<string>(a, "create_group", { p_title: "Just three", p_member_ids: [b, c] });
      expect(await errorOf(rpc(a, "add_group_members", { p_conversation_id: group, p_member_ids: [d] }))).toMatch(/group_full/);
    });
    await withSetting("groups.max_per_day", "2", async () => {
      // One made above, one more now; the third is too many.
      await rpc(a, "create_group", { p_title: "Second", p_member_ids: [b] });
      expect(await errorOf(rpc(a, "create_group", { p_title: "Third", p_member_ids: [b] }))).toMatch(/rate_limited/);
    });
  });

  it("visitors are refused, and nobody writes members or roles directly", async () => {
    const [a, b] = [await createUser("Direct write a"), await createUser("Direct write b")];
    await befriend(a, b);
    const group = await rpc<string>(a, "create_group", { p_title: "Locked doors", p_member_ids: [b] });
    expect(await errorOf(rpc(null, "create_group", { p_title: "Anon", p_member_ids: [a] }))).toMatch(/permission denied/);
    expect(await errorOf(asUser(b, "update public.conversation_members set role = 'admin' where conversation_id = $1 and user_id = $2", [group, b]))).toMatch(/permission denied/);
    expect(await errorOf(asUser(b, "insert into public.conversation_members (conversation_id, user_id, role) values ($1, $2, 'admin')", [group, (await createUser("Sneaky")) ]))).toMatch(/permission denied/);
    expect(await errorOf(asUser(b, "update public.conversations set title = 'Hijacked' where id = $1", [group]))).toMatch(/permission denied/);
    expect(await rolesOf(group)).toEqual({ [a]: "admin", [b]: "member" });
  });
});
