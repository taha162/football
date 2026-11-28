import { randomUUID } from "node:crypto";
import { admin, createAuthUser, expect, rpc, test } from "./fixtures";

/** Phone notifications (migration 0051): the database's wake-up reaches /api/push, which empties the queue. */
test.describe("Phone notifications", () => {
  test("only the scheduler's secret wakes the sender, which hands out what waits", async ({ request }) => {
    const [me, friend] = [await createAuthUser("Sender"), await createAuthUser("Phone owner")];
    await rpc(friend.id, "register_push_device", { p_token: `e2e_${randomUUID()}${randomUUID()}`, p_platform: "android" });
    const conv = await rpc<string>(me.id, "start_direct_conversation", { p_user_id: friend.id });
    await rpc(me.id, "send_message", { p_conversation_id: conv, p_body: "مباراة الليلة؟" });
    expect(await admin("select 1 from private.push_outbox where user_id = $1", [friend.id])).toHaveLength(1);

    expect((await request.post("/api/push")).status()).toBe(401);
    expect((await request.post("/api/push", { headers: { Authorization: "Bearer not-the-secret-at-all" } })).status()).toBe(401);
    const res = await request.post("/api/push", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    // Handed out once (here without push keys: nothing to send it with, so it is simply dropped).
    expect(await admin("select 1 from private.push_outbox where user_id = $1", [friend.id])).toHaveLength(0);
  });
});
