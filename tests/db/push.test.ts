import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { admin, createUser, errorOf, rpc } from "./helpers";

/** Notifications on the phone (migration 0051): devices, what is queued for whom, and handing it out once. */

const token = () => `tok_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
const queued = (user: string) => admin<{ kind: string; ref: string }>("select kind, ref from private.push_outbox where user_id = $1 order by id", [user]);
const claim = () => admin<{ kind: string; ref: string; user_id: string; devices: { token: string; platform: string }[] }>("select * from public.claim_push_batch(500)");

describe("phone notifications", () => {
  afterAll(async () => {
    await admin("delete from vault.secrets where name in ('push_endpoint', 'push_secret')");
  });

  it("members register their phone; a phone that signs in to another account moves to it; visitors can't", async () => {
    const [a, b] = [await createUser("Phone A"), await createUser("Phone B")];
    const t = token();
    await rpc(a, "register_push_device", { p_token: t, p_platform: "android" });
    expect(await admin("select user_id from public.push_devices where token = $1", [t])).toEqual([{ user_id: a }]);
    await rpc(b, "register_push_device", { p_token: t, p_platform: "android" });
    expect(await admin("select user_id from public.push_devices where token = $1", [t])).toEqual([{ user_id: b }]);
    expect(await errorOf(rpc(a, "register_push_device", { p_token: "short", p_platform: "android" }))).toMatch(/invalid_device/);
    expect(await errorOf(rpc(a, "register_push_device", { p_token: token(), p_platform: "windows" }))).toMatch(/invalid_device/);
    expect(await errorOf(rpc(null, "register_push_device", { p_token: token(), p_platform: "ios" }))).toMatch(/permission denied/);
    // Someone else's phone can't be signed out by another member.
    await rpc(a, "unregister_push_device", { p_token: t });
    expect(await admin("select 1 from public.push_devices where token = $1", [t])).toHaveLength(1);
    await rpc(b, "unregister_push_device", { p_token: t });
    expect(await admin("select 1 from public.push_devices where token = $1", [t])).toHaveLength(0);
    // Ten phones at most: the oldest goes.
    for (let i = 0; i < 12; i++) await rpc(a, "register_push_device", { p_token: token(), p_platform: "ios" });
    expect(await admin("select 1 from public.push_devices where user_id = $1", [a])).toHaveLength(10);
  });

  it("a message is queued for the others with a phone, unless muted, blocked, or a call", async () => {
    const [me, phone, noPhone, muted] = [await createUser("Sender"), await createUser("Has phone"), await createUser("No phone"), await createUser("Muted")];
    await rpc(phone, "register_push_device", { p_token: token(), p_platform: "android" });
    await rpc(muted, "register_push_device", { p_token: token(), p_platform: "ios" });
    const toPhone = await rpc<string>(me, "start_direct_conversation", { p_user_id: phone });
    const toNoPhone = await rpc<string>(me, "start_direct_conversation", { p_user_id: noPhone });
    const toMuted = await rpc<string>(me, "start_direct_conversation", { p_user_id: muted });
    await rpc(muted, "set_conversation_muted", { p_conversation_id: toMuted, p_until: "infinity" }).catch(async () => {
      await admin("insert into public.conversation_prefs (user_id, conversation_id, muted_until) values ($1, $2, 'infinity')", [muted, toMuted]);
    });

    await rpc(me, "send_message", { p_conversation_id: toPhone, p_body: "أهلاً" });
    await rpc(me, "send_message", { p_conversation_id: toNoPhone, p_body: "أهلاً" });
    await rpc(me, "send_message", { p_conversation_id: toMuted, p_body: "أهلاً" });
    expect((await queued(phone)).map((q) => q.kind)).toEqual(["message"]);
    expect(await queued(noPhone)).toEqual([]);
    expect(await queued(muted)).toEqual([]);
    expect(await queued(me)).toEqual([]);

    await rpc(phone, "block_user", { p_user_id: me });
    await admin("delete from private.push_outbox where user_id = $1", [phone]);
    await admin("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'بعد الحظر')", [toPhone, me]);
    expect(await queued(phone)).toEqual([]);
  });

  it("a notification is queued too, and the site gets each once with the phones to send it to", async () => {
    const [me, other] = [await createUser("Notified"), await createUser("Other")];
    const t = token();
    await rpc(me, "register_push_device", { p_token: t, p_platform: "ios" });
    const [{ id }] = await admin<{ id: string }>("insert into public.notifications (user_id, type, payload) values ($1, 'friend_accepted', '{}') returning id", [me]);
    await admin("insert into public.notifications (user_id, type, payload) values ($1, 'friend_accepted', '{}')", [other]);
    expect(await queued(me)).toEqual([{ kind: "notification", ref: id }]);
    expect(await queued(other)).toEqual([]);

    const batch = (await claim()).filter((r) => r.user_id === me);
    expect(batch).toEqual([{ kind: "notification", ref: id, user_id: me, devices: [{ token: t, platform: "ios" }] }]);
    expect(await queued(me)).toEqual([]);
    expect((await claim()).filter((r) => r.user_id === me)).toEqual([]);

    // A phone the push service says is gone is forgotten.
    await admin("select public.forget_push_tokens($1)", [[t]]);
    expect(await admin("select 1 from public.push_devices where token = $1", [t])).toHaveLength(0);
    // Only the server key: not members.
    expect(await errorOf(rpc(me, "claim_push_batch", { p_limit: 10 }))).toMatch(/permission denied/);
    expect(await errorOf(rpc(me, "forget_push_tokens", { p_tokens: [t] }))).toMatch(/permission denied/);
  });

  it("when the database knows the site's address, it wakes the site at once; deleting the account forgets the phones", async () => {
    await admin("select vault.create_secret('http://127.0.0.1:9/api/push', 'push_endpoint')");
    await admin("select vault.create_secret('test-secret', 'push_secret')");
    const me = await createUser("Woken");
    await rpc(me, "register_push_device", { p_token: token(), p_platform: "android" });
    const [{ before }] = await admin<{ before: string }>("select coalesce(max(id), 0)::text as before from net.http_request_queue");
    await admin("insert into public.notifications (user_id, type, payload) values ($1, 'friend_accepted', '{}')", [me]);
    const calls = await admin<{ url: string; headers: Record<string, string> }>("select url, headers from net.http_request_queue where id > $1", [before]);
    expect(calls.some((c) => c.url === "http://127.0.0.1:9/api/push" && c.headers.Authorization === "Bearer test-secret")).toBe(true);

    await admin("delete from auth.users where id = $1", [me]);
    expect(await admin("select 1 from public.push_devices where user_id = $1", [me])).toHaveLength(0);
  });
});
