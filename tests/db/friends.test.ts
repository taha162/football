import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, notificationsOf, rpc, rpcRows } from "./helpers";

type Friend = { user_id: string; username: string; relation: string };
const usernameOf = async (id: string) => (await admin<{ username: string }>("select username from public.profiles where id = $1", [id]))[0].username;
const friendsOf = (id: string) => rpcRows<Friend>(id, "my_friends");
const relation = async (me: string, other: string) => (await friendsOf(me)).find((f) => f.user_id === other)?.relation;

/** Migration 0042: friends, added by username. */
describe("friends", () => {
  it("a request by username (typed with @ and capitals) is accepted, with a notice each way", async () => {
    const [a, b] = [await createUser("Friend a"), await createUser("Friend b")];
    expect(await rpc(a, "send_friend_request", { p_username: `@${(await usernameOf(b)).toUpperCase()}` })).toBe("requested");
    expect(await relation(a, b)).toBe("requested");
    expect(await relation(b, a)).toBe("incoming");
    expect((await notificationsOf(b, "friend_request")).length).toBe(1);
    // Asking again changes nothing and sends no second notice.
    expect(await rpc(a, "send_friend_request", { p_username: await usernameOf(b) })).toBe("requested");
    expect((await notificationsOf(b, "friend_request")).length).toBe(1);

    await rpc(b, "respond_friend_request", { p_user_id: a, p_accept: true });
    expect(await relation(a, b)).toBe("friend");
    expect(await relation(b, a)).toBe("friend");
    expect((await notificationsOf(a, "friend_accepted")).length).toBe(1);
    expect(await rpc(a, "send_friend_request", { p_username: await usernameOf(b) })).toBe("friends");
  });

  it("asking someone who already asked you makes you friends at once", async () => {
    const [a, b] = [await createUser("Mutual a"), await createUser("Mutual b")];
    await rpc(a, "send_friend_request", { p_username: await usernameOf(b) });
    expect(await rpc(b, "send_friend_request", { p_username: await usernameOf(a) })).toBe("friends");
    expect(await relation(a, b)).toBe("friend");
  });

  it("declining, cancelling and removing leave nothing behind", async () => {
    const [a, b] = [await createUser("Undo a"), await createUser("Undo b")];
    await rpc(a, "send_friend_request", { p_username: await usernameOf(b) });
    await rpc(b, "respond_friend_request", { p_user_id: a, p_accept: false });
    expect(await relation(a, b)).toBeUndefined();
    // Only the one asked can answer.
    await rpc(a, "send_friend_request", { p_username: await usernameOf(b) });
    expect(await errorOf(rpc(a, "respond_friend_request", { p_user_id: b, p_accept: true }))).toMatch(/request_not_found/);
    await rpc(a, "cancel_friend_request", { p_user_id: b });
    expect(await relation(b, a)).toBeUndefined();
    await rpc(a, "send_friend_request", { p_username: await usernameOf(b) });
    await rpc(b, "respond_friend_request", { p_user_id: a, p_accept: true });
    await rpc(b, "remove_friend", { p_user_id: a });
    expect(await relation(a, b)).toBeUndefined();
  });

  it("no requests to oneself, to someone unknown, or across a block; blocking ends a friendship", async () => {
    const [a, b, c] = [await createUser("Block a"), await createUser("Block b"), await createUser("Block c")];
    expect(await errorOf(rpc(a, "send_friend_request", { p_username: await usernameOf(a) }))).toMatch(/cannot_friend_self/);
    expect(await errorOf(rpc(a, "send_friend_request", { p_username: "nobody_has_this_name" }))).toMatch(/user_not_found/);
    await rpc(b, "block_user", { p_user_id: a });
    expect(await errorOf(rpc(a, "send_friend_request", { p_username: await usernameOf(b) }))).toMatch(/user_blocked/);
    await rpc(a, "send_friend_request", { p_username: await usernameOf(c) });
    await rpc(c, "respond_friend_request", { p_user_id: a, p_accept: true });
    await rpc(c, "block_user", { p_user_id: a });
    expect(await relation(a, c)).toBeUndefined();
    // A suspended member can't be found.
    await admin("update public.profiles set status = 'suspended' where id = $1", [b]);
    expect(await rpcRows(a, "find_member", { p_username: await usernameOf(b) })).toHaveLength(0);
  });

  it("find_member says where the caller stands; only the pair sees their row; visitors get nothing", async () => {
    const [a, b, stranger] = [await createUser("Find a"), await createUser("Find b"), await createUser("Find stranger")];
    const found = async (me: string, other: string) => (await rpcRows<{ id: string; relation: string }>(me, "find_member", { p_username: await usernameOf(other) }))[0];
    expect(await found(a, b)).toMatchObject({ id: b, relation: "none" });
    expect((await found(a, a)).relation).toBe("self");
    await rpc(a, "send_friend_request", { p_username: await usernameOf(b) });
    expect((await found(a, b)).relation).toBe("requested");
    expect((await found(b, a)).relation).toBe("incoming");
    expect(await asUser(stranger, "select * from public.friendships where requested_by = $1", [a])).toHaveLength(0);
    expect(await errorOf(rpcRows(null, "find_member", { p_username: await usernameOf(a) }))).toMatch(/permission denied/);
    expect(await errorOf(asUser(a, "insert into public.friendships (user_a, user_b, requested_by) values ($1, $2, $1)", [a < stranger ? a : stranger, a < stranger ? stranger : a]))).toMatch(/permission denied/);
  });

  it("a member can send only so many requests a day", async () => {
    const me = await createUser("Busy asker");
    const others = await Promise.all(Array.from({ length: 3 }, (_, i) => createUser(`Asked ${i}`)));
    const [{ value }] = await admin<{ value: unknown }>("select value from public.platform_settings where key = 'friends.max_requests_per_day'");
    await admin("update public.platform_settings set value = '2'::jsonb where key = 'friends.max_requests_per_day'");
    try {
      await rpc(me, "send_friend_request", { p_username: await usernameOf(others[0]) });
      await rpc(me, "send_friend_request", { p_username: await usernameOf(others[1]) });
      expect(await errorOf(rpc(me, "send_friend_request", { p_username: await usernameOf(others[2]) }))).toMatch(/rate_limited/);
    } finally {
      await admin("update public.platform_settings set value = $1::jsonb where key = 'friends.max_requests_per_day'", [JSON.stringify(value)]);
    }
  });
});
