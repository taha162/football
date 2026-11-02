import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, rpc, rpcRows } from "./helpers";

/** What the server does after checking the picture: store it under the conversation's folder. */
async function storePicture(conversationId: string, ext = "jpg"): Promise<string> {
  const name = `${conversationId}/${randomUUID()}.${ext}`;
  await admin("insert into storage.objects (bucket_id, name) values ('message-images', $1)", [name]);
  return name;
}

const canSeeObject = async (actor: string | null, name: string) =>
  (await asUser(actor, "select 1 from storage.objects where bucket_id = 'message-images' and name = $1", [name])).length === 1;

describe("pictures in conversations", () => {
  it("a member sends a picture with or without text; the members can open it, nobody else can", async () => {
    const [a, b, stranger] = [await createUser(), await createUser(), await createUser()];
    const moderator = await createUser("Mod");
    await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [moderator]);
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });

    const picture = await storePicture(conv);
    const id = await rpc<number>(a, "send_message", { p_conversation_id: conv, p_body: "", p_image_path: picture });
    const withText = await rpc<number>(a, "send_message", { p_conversation_id: conv, p_body: "ملعب الزهور", p_image_path: await storePicture(conv, "png") });
    expect(id).toBeTruthy();
    expect(withText).toBeTruthy();
    const [row] = await asUser<{ body: string; image_path: string }>(b, "select body, image_path from public.messages where id = $1", [id]);
    expect(row).toEqual({ body: "", image_path: picture });

    // The private bucket: members and moderators read, others don't.
    expect(await canSeeObject(a, picture)).toBe(true);
    expect(await canSeeObject(b, picture)).toBe(true);
    expect(await canSeeObject(moderator, picture)).toBe(true);
    expect(await canSeeObject(stranger, picture)).toBe(false);
    expect(await canSeeObject(null, picture)).toBe(false);
    // Nobody uploads directly; the server does, after checking membership.
    expect(await errorOf(asUser(a, "insert into storage.objects (bucket_id, name) values ('message-images', $1)", [`${conv}/${randomUUID()}.jpg`]))).toMatch(/row-level security|permission/);

    // The conversation list previews a picture-only message as empty text (the page shows «📷 صورة»).
    const list = await rpcRows<{ conversation_id: string; last_message: string }>(b, "my_conversations");
    expect(list.find((c) => c.conversation_id === conv)?.last_message).toBe("ملعب الزهور");
  });

  it("refuses pictures from another conversation, made-up paths and empty messages", async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const mine = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
    const theirs = await rpc<string>(b, "start_direct_conversation", { p_user_id: c });
    const elsewhere = await storePicture(theirs);
    expect(await errorOf(rpc(a, "send_message", { p_conversation_id: mine, p_body: "", p_image_path: elsewhere }))).toBe("invalid_image");
    expect(await errorOf(rpc(a, "send_message", { p_conversation_id: mine, p_body: "x", p_image_path: `${mine}/${randomUUID()}.jpg` }))).toBe("invalid_image");
    expect(await errorOf(rpc(a, "send_message", { p_conversation_id: mine, p_body: "x", p_image_path: `${mine}/../secret.jpg` }))).toBe("invalid_image");
    expect(await errorOf(rpc(a, "send_message", { p_conversation_id: mine, p_body: "  " }))).toBe("invalid_message");
    // Text-only messages work as before.
    expect(await rpc<number>(a, "send_message", { p_conversation_id: mine, p_body: "مرحبا" })).toBeTruthy();
  });

  it("deleting a message, or a moderator removing it, drops the picture from the message", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const moderator = await createUser("Mod");
    await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [moderator]);
    const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });

    const own = await rpc<number>(a, "send_message", { p_conversation_id: conv, p_body: "", p_image_path: await storePicture(conv) });
    await rpc(a, "delete_message", { p_message_id: own });
    const reported = await rpc<number>(a, "send_message", { p_conversation_id: conv, p_body: "", p_image_path: await storePicture(conv) });
    await rpc(moderator, "admin_remove_message", { p_message_id: reported, p_reason: "Inappropriate picture" });

    const rows = await admin<{ id: string; body: string; image_path: string | null }>(
      "select id::text, body, image_path from public.messages where id = any($1::bigint[]) order by id",
      [[own, reported]],
    );
    expect(rows).toEqual([
      { id: String(own), body: "[deleted]", image_path: null },
      { id: String(reported), body: "[removed]", image_path: null },
    ]);
  });
});
