import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc, rpcRows } from "./helpers";

/** What the browser's upload leaves in storage: an object under the conversation's folder. */
async function stored(name: string, mimetype = "video/mp4", ageDays = 0) {
  await admin(
    `insert into storage.objects (bucket_id, name, metadata, created_at)
     values ('message-videos', $1, jsonb_build_object('mimetype', $2::text, 'size', 2048), now() - make_interval(days => $3))`,
    [name, mimetype, ageDays],
  );
  return name;
}
const videoIn = (conversation: string, ext = "mp4") => `${conversation}/${randomUUID()}.${ext}`;
const send = (user: string, conversation: string, extra: Record<string, unknown>) =>
  rpc<number>(user, "send_message", { p_conversation_id: conversation, p_body: "", ...extra });
const canSee = async (user: string, name: string) =>
  (await asUser(user, "select 1 from storage.objects where bucket_id = 'message-videos' and name = $1", [name])).length === 1;

/** Migration 0045: videos in conversations. */
describe("videos in conversations", () => {
  it("a member sends a video stored in the conversation's folder; only its members see it; deleting erases it", async () => {
    const [a, b, stranger] = [await createUser("Video a"), await createUser("Video b"), await createUser("Video stranger")];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    await rpc(a, "begin_video_upload", { p_conversation_id: conv });
    const path = await stored(videoIn(conv));
    await stored(path.replace(/\.mp4$/, ".poster.jpg"), "image/jpeg");
    const id = await send(a, conv, { p_video_path: path, p_video_seconds: 12 });
    expect(await asUser(b, "select video_path, video_seconds from public.messages where id = $1", [id])).toEqual([{ video_path: path, video_seconds: 12 }]);
    expect(await canSee(b, path)).toBe(true);
    expect(await canSee(stranger, path)).toBe(false);
    const row = (await rpcRows<{ conversation_id: string; last_kind: string }>(b, "my_conversations", { p_limit: 50 })).find((c) => c.conversation_id === conv);
    expect(row?.last_kind).toBe("video");

    await rpc(a, "delete_message", { p_message_id: id });
    expect((await admin("select video_path, video_seconds, body from public.messages where id = $1", [id]))[0]).toEqual({ video_path: null, video_seconds: null, body: "[deleted]" });
  });

  it("only a real video, in this conversation's folder, with a sensible length, and alone", async () => {
    const [a, b] = [await createUser("Strict a"), await createUser("Strict b")];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const other = await rpc<string>(a, "start_direct_conversation", { p_user_id: await createUser("Strict c") });
    const elsewhere = await stored(videoIn(other));
    expect(await errorOf(send(a, conv, { p_video_path: elsewhere }))).toMatch(/invalid_video/);
    expect(await errorOf(send(a, conv, { p_video_path: videoIn(conv) }))).toMatch(/invalid_video/); // never uploaded
    const picture = await stored(videoIn(conv), "image/jpeg");
    expect(await errorOf(send(a, conv, { p_video_path: picture }))).toMatch(/invalid_video/);
    const clip = await stored(videoIn(conv, "mov"), "video/quicktime");
    expect(await errorOf(send(a, conv, { p_video_path: clip, p_video_seconds: 0 }))).toMatch(/invalid_video/);
    expect(await errorOf(send(a, conv, { p_video_path: clip, p_video_seconds: 4000 }))).toMatch(/invalid_video/);
    expect(await errorOf(send(a, conv, { p_video_path: clip, p_location_lat: 36.3, p_location_lng: 43.1 }))).toMatch(/invalid_message/);
    // Its length isn't always known: still sent.
    expect(Number(await send(a, conv, { p_video_path: clip }))).toBeGreaterThan(0);
  });

  it("an upload may start only for a member, in an open conversation, so many an hour", async () => {
    const [a, b, stranger] = [await createUser("Upload a"), await createUser("Upload b"), await createUser("Upload stranger")];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    expect(await errorOf(rpc(stranger, "begin_video_upload", { p_conversation_id: conv }))).toMatch(/conversation_not_found/);
    expect(await errorOf(rpc(null, "begin_video_upload", { p_conversation_id: conv }))).toMatch(/permission denied/);
    const [{ value }] = await admin<{ value: unknown }>("select value from public.platform_settings where key = 'messaging.max_videos_per_hour'");
    await admin("update public.platform_settings set value = '2'::jsonb where key = 'messaging.max_videos_per_hour'");
    try {
      await rpc(a, "begin_video_upload", { p_conversation_id: conv });
      await rpc(a, "begin_video_upload", { p_conversation_id: conv });
      expect(await errorOf(rpc(a, "begin_video_upload", { p_conversation_id: conv }))).toMatch(/rate_limited/);
    } finally {
      await admin("update public.platform_settings set value = $1::jsonb where key = 'messaging.max_videos_per_hour'", [JSON.stringify(value)]);
    }
    await admin("update public.conversations set is_locked = true where id = $1", [conv]);
    expect(await errorOf(rpc(b, "begin_video_upload", { p_conversation_id: conv }))).toMatch(/conversation_locked/);
  });

  it("a moderator's removal erases the video too", async () => {
    const [a, b, mod] = [await createUser("Removed a"), await createUser("Removed b"), await createUser("Removing mod")];
    await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [mod]);
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const path = await stored(videoIn(conv));
    // Moderators may watch it (the report shows it), like pictures.
    expect(await canSee(mod, path)).toBe(true);
    const id = await send(a, conv, { p_video_path: path, p_video_seconds: 5 });
    await rpc(mod, "admin_remove_message", { p_message_id: id, p_reason: "not allowed here" });
    expect((await admin("select video_path, body from public.messages where id = $1", [id]))[0]).toEqual({ video_path: null, body: "[removed]" });
  });

  it("uploads no message points at are listed for removal a day later, for the server key only", async () => {
    const [a, b] = [await createUser("Orphan a"), await createUser("Orphan b")];
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const kept = await stored(videoIn(conv), "video/mp4", 2);
    const keptStill = await stored(kept.replace(/\.mp4$/, ".poster.jpg"), "image/jpeg", 2);
    await send(a, conv, { p_video_path: kept });
    const abandoned = await stored(videoIn(conv), "video/mp4", 2);
    const abandonedStill = await stored(abandoned.replace(/\.mp4$/, ".poster.jpg"), "image/jpeg", 2);
    const fresh = await stored(videoIn(conv), "video/mp4", 0);
    const listed = (await admin<{ name: string }>("select name from public.orphan_message_videos(1000) as name")).map((r) => r.name);
    expect(listed).toEqual(expect.arrayContaining([abandoned, abandonedStill]));
    for (const name of [kept, keptStill, fresh]) expect(listed).not.toContain(name);
    expect(await errorOf(rpcRows(a, "orphan_message_videos", { p_limit: 10 }))).toMatch(/permission denied/);
  });
});
