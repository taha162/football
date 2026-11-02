import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, asUser, createUser, errorOf, mosul, rpc, rpcRows } from "./helpers";

/** What the server does after checking the recording: store it under the conversation's folder. */
async function storeVoice(conversationId: string, ext = "webm"): Promise<string> {
  const name = `${conversationId}/${randomUUID()}.${ext}`;
  await admin("insert into storage.objects (bucket_id, name) values ('message-voice', $1)", [name]);
  return name;
}

const listEntry = async (user: string, conv: string) =>
  (await rpcRows<{ conversation_id: string; last_kind: string; last_message: string; unread_count: string }>(user, "my_conversations")).find(
    (c) => c.conversation_id === conv,
  );

async function pair() {
  const [a, b] = [await createUser("Caller"), await createUser("Callee")];
  const conv = await rpc<string>(a, "start_direct_conversation", { p_user_id: b });
  return { a, b, conv };
}

describe("a shared location", () => {
  it("members see the point (rounded) and how accurate it was; nobody else does", async () => {
    const { a, b, conv } = await pair();
    const stranger = await createUser();
    const id = await rpc<number>(a, "send_message", {
      p_conversation_id: conv,
      p_body: "",
      p_location_lat: 36.3456789123,
      p_location_lng: 43.1234567891,
      p_location_accuracy: 12.6,
    });
    const [row] = await asUser<{ location_lat: number; location_lng: number; location_accuracy: number }>(
      b,
      "select location_lat, location_lng, location_accuracy from public.messages where id = $1",
      [id],
    );
    expect(row).toEqual({ location_lat: 36.345679, location_lng: 43.123457, location_accuracy: 13 });
    expect(await asUser(stranger, "select 1 from public.messages where id = $1", [id])).toHaveLength(0);
    expect((await listEntry(b, conv))?.last_kind).toBe("location");
  });

  it("refuses impossible points, half a point, and a location together with a picture", async () => {
    const { a, conv } = await pair();
    const send = (args: Record<string, unknown>) => errorOf(rpc(a, "send_message", { p_conversation_id: conv, p_body: "", ...args }));
    expect(await send({ p_location_lat: 91, p_location_lng: 43 })).toBe("invalid_location");
    expect(await send({ p_location_lat: 36, p_location_lng: -181 })).toBe("invalid_location");
    expect(await send({ p_location_lat: "NaN", p_location_lng: 43 })).toBe("invalid_location");
    expect(await send({ p_location_lat: 36 })).toBe("invalid_location");
    expect(await send({ p_location_lat: 36, p_location_lng: 43, p_location_accuracy: -1 })).toBe("invalid_location");
    const picture = `${conv}/${randomUUID()}.jpg`;
    await admin("insert into storage.objects (bucket_id, name) values ('message-images', $1)", [picture]);
    expect(await send({ p_location_lat: 36, p_location_lng: 43, p_image_path: picture })).toBe("invalid_message");
  });

  it("deleting the message erases the point", async () => {
    const { a, conv } = await pair();
    const id = await rpc<number>(a, "send_message", { p_conversation_id: conv, p_body: "", p_location_lat: 36.3, p_location_lng: 43.1 });
    await rpc(a, "delete_message", { p_message_id: id });
    const [row] = await admin("select body, location_lat, location_lng, location_accuracy from public.messages where id = $1", [id]);
    expect(row).toEqual({ body: "[deleted]", location_lat: null, location_lng: null, location_accuracy: null });
  });
});

describe("voice notes", () => {
  it("a member sends a recording with its length; members and moderators can open it, nobody else can", async () => {
    const { a, b, conv } = await pair();
    const [stranger, moderator] = [await createUser(), await createUser("Mod")];
    await admin("insert into public.user_roles (user_id, role) values ($1, 'moderator')", [moderator]);
    const voice = await storeVoice(conv);
    const id = await rpc<number>(a, "send_message", { p_conversation_id: conv, p_body: "", p_voice_path: voice, p_voice_seconds: 7 });
    const [row] = await asUser(b, "select body, voice_path, voice_seconds from public.messages where id = $1", [id]);
    expect(row).toEqual({ body: "", voice_path: voice, voice_seconds: 7 });

    const canSee = async (actor: string | null) =>
      (await asUser(actor, "select 1 from storage.objects where bucket_id = 'message-voice' and name = $1", [voice])).length === 1;
    expect(await canSee(a)).toBe(true);
    expect(await canSee(b)).toBe(true);
    expect(await canSee(moderator)).toBe(true);
    expect(await canSee(stranger)).toBe(false);
    expect(await canSee(null)).toBe(false);
    // Nobody uploads directly; the server does, after checking membership.
    expect(await errorOf(asUser(a, "insert into storage.objects (bucket_id, name) values ('message-voice', $1)", [`${conv}/${randomUUID()}.webm`]))).toMatch(
      /row-level security|permission/,
    );
    expect((await listEntry(b, conv))?.last_kind).toBe("voice");

    await rpc(a, "delete_message", { p_message_id: id });
    const [after] = await admin("select voice_path, voice_seconds from public.messages where id = $1", [id]);
    expect(after).toEqual({ voice_path: null, voice_seconds: null });
  });

  it("refuses recordings from another conversation, made-up paths and missing or impossible lengths", async () => {
    const { a, b, conv } = await pair();
    const c = await createUser();
    const theirs = await rpc<string>(b, "start_direct_conversation", { p_user_id: c });
    const send = (args: Record<string, unknown>) => errorOf(rpc(a, "send_message", { p_conversation_id: conv, p_body: "", ...args }));
    expect(await send({ p_voice_path: await storeVoice(theirs), p_voice_seconds: 3 })).toBe("invalid_voice");
    expect(await send({ p_voice_path: `${conv}/${randomUUID()}.webm`, p_voice_seconds: 3 })).toBe("invalid_voice");
    expect(await send({ p_voice_path: await storeVoice(conv), p_voice_seconds: null })).toBe("invalid_voice");
    expect(await send({ p_voice_path: await storeVoice(conv, "m4a"), p_voice_seconds: 301 })).toBe("invalid_voice");
    expect(await rpc<number>(a, "send_message", { p_conversation_id: conv, p_body: "", p_voice_path: await storeVoice(conv, "m4a"), p_voice_seconds: 300 })).toBeTruthy();
  });
});

describe("voice calls", () => {
  it("rings the other member, connects through signals only the two can see, and records the call", async () => {
    const { a, b, conv } = await pair();
    const stranger = await createUser();
    const call = await rpc<string>(a, "start_call", { p_conversation_id: conv });
    const visible = async (actor: string) => (await asUser<{ status: string }>(actor, "select status from public.calls where id = $1", [call]))[0]?.status;
    expect(await visible(b)).toBe("ringing");
    expect(await visible(stranger)).toBeUndefined();

    // Only the person called answers.
    expect(await errorOf(rpc(a, "answer_call", { p_call_id: call }))).toBe("call_not_found");
    expect(await errorOf(rpc(stranger, "answer_call", { p_call_id: call }))).toBe("call_not_found");
    expect(await rpc(b, "answer_call", { p_call_id: call })).toBe("active");

    await rpc(a, "send_call_signal", { p_call_id: call, p_kind: "offer", p_payload: { type: "offer", sdp: "v=0" } });
    await rpc(b, "send_call_signal", { p_call_id: call, p_kind: "answer", p_payload: { type: "answer", sdp: "v=0" } });
    await rpc(b, "send_call_signal", { p_call_id: call, p_kind: "candidate", p_payload: { candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host" } });
    const seen = (actor: string) => asUser<{ kind: string }>(actor, "select kind from public.call_signals where call_id = $1 order by id", [call]);
    expect((await seen(a)).map((s) => s.kind)).toEqual(["offer", "answer", "candidate"]);
    expect(await seen(stranger)).toHaveLength(0);
    expect(await errorOf(rpc(stranger, "send_call_signal", { p_call_id: call, p_kind: "offer", p_payload: {} }))).toBe("call_not_found");
    expect(await errorOf(rpc(a, "send_call_signal", { p_call_id: call, p_kind: "bogus", p_payload: {} }))).toBe("invalid_signal");
    expect(await errorOf(rpc(a, "send_call_signal", { p_call_id: call, p_kind: "offer", p_payload: "[1]" }))).toBe("invalid_signal");
    // Nobody writes call tables directly.
    expect(await errorOf(asUser(a, "update public.calls set status = 'ended' where id = $1", [call]))).toMatch(/permission/);
    expect(await errorOf(asUser(a, "insert into public.call_signals (call_id, sender_id, kind, payload) values ($1, $2, 'offer', '{}')", [call, a]))).toMatch(/permission/);

    await admin("update public.calls set answered_at = now() - interval '192 seconds' where id = $1", [call]);
    expect(await rpc(b, "end_call", { p_call_id: call })).toBe("ended");
    // Ending again changes nothing; the set-up messages are gone.
    expect(await rpc(a, "end_call", { p_call_id: call })).toBe("ended");
    expect(await admin("select 1 from public.call_signals where call_id = $1", [call])).toHaveLength(0);
    expect(await errorOf(rpc(a, "send_call_signal", { p_call_id: call, p_kind: "candidate", p_payload: {} }))).toBe("call_ended");

    const [line] = await asUser<{ sender_id: string; call_outcome: string; call_seconds: number }>(
      b,
      "select sender_id, call_outcome, call_seconds from public.messages where conversation_id = $1 order by id desc limit 1",
      [conv],
    );
    expect(line).toEqual({ sender_id: a, call_outcome: "answered", call_seconds: 192 });
    const entry = await listEntry(b, conv);
    expect(entry?.last_kind).toBe("call");
    expect(Number(entry?.unread_count)).toBe(0);
  });

  it("a call nobody answers is missed: the person called gets a notification and an unread line", async () => {
    const { a, b, conv } = await pair();
    const call = await rpc<string>(a, "start_call", { p_conversation_id: conv });
    expect(await rpc(a, "end_call", { p_call_id: call })).toBe("missed");
    const [line] = await admin("select call_outcome, call_seconds from public.messages where conversation_id = $1 order by id desc limit 1", [conv]);
    expect(line).toEqual({ call_outcome: "missed", call_seconds: null });
    const notes = await asUser<{ type: string; payload: { conversation_id: string } }>(b, "select type, payload from public.notifications where type = 'missed_call'");
    expect(notes).toHaveLength(1);
    expect(notes[0].payload.conversation_id).toBe(conv);
    expect(Number((await listEntry(b, conv))?.unread_count)).toBe(1);
    expect(Number((await listEntry(a, conv))?.unread_count)).toBe(0);
  });

  it("a declined call is recorded without a notification", async () => {
    const { a, b, conv } = await pair();
    const call = await rpc<string>(a, "start_call", { p_conversation_id: conv });
    expect(await rpc(b, "end_call", { p_call_id: call, p_reason: "decline" })).toBe("declined");
    expect(await asUser(b, "select 1 from public.notifications where type = 'missed_call'")).toHaveLength(0);
    expect(Number((await listEntry(b, conv))?.unread_count)).toBe(0);
  });

  it("someone already on a call is busy, until that call goes stale", async () => {
    const { a, b, conv } = await pair();
    const c = await createUser();
    const other = await rpc<string>(c, "start_direct_conversation", { p_user_id: b });
    const first = await rpc<string>(a, "start_call", { p_conversation_id: conv });
    expect(await errorOf(rpc(c, "start_call", { p_conversation_id: other }))).toBe("user_busy");
    // A minute of ringing without an answer: the first call is missed, and B is free.
    await admin("update public.calls set created_at = now() - interval '2 minutes' where id = $1", [first]);
    const second = await rpc<string>(c, "start_call", { p_conversation_id: other });
    expect(second).toBeTruthy();
    expect((await admin("select status from public.calls where id = $1", [first]))[0].status).toBe("missed");
  });

  it("an active call that one side stopped checking in on ends; a check-in reports it", async () => {
    const { a, b, conv } = await pair();
    const call = await rpc<string>(a, "start_call", { p_conversation_id: conv });
    await rpc(b, "answer_call", { p_call_id: call });
    expect(await rpc(a, "call_heartbeat", { p_call_id: call })).toBe("active");
    await admin("update public.calls set callee_seen_at = now() - interval '2 minutes' where id = $1", [call]);
    expect(await rpc(a, "call_heartbeat", { p_call_id: call })).toBe("ended");
  });

  it("starting a new call ends the caller's own open call", async () => {
    const { a, b, conv } = await pair();
    const c = await createUser();
    const conv2 = await rpc<string>(a, "start_direct_conversation", { p_user_id: c });
    const first = await rpc<string>(a, "start_call", { p_conversation_id: conv });
    await rpc(b, "answer_call", { p_call_id: first });
    await rpc<string>(a, "start_call", { p_conversation_id: conv2 });
    expect((await admin("select status from public.calls where id = $1", [first]))[0].status).toBe("ended");
  });

  it("only direct conversations, never with a blocked person, and the clean-up is for the server only", async () => {
    const { a, b, conv } = await pair();
    const team = await rpc<string>(a, "create_team", { p_name: `Call FC ${a.slice(0, 4)}`, p_city_id: await mosul() });
    const teamConv = await rpc<string>(a, "entity_conversation_id", { p_kind: "team", p_entity_id: team });
    expect(await errorOf(rpc(a, "start_call", { p_conversation_id: teamConv }))).toBe("conversation_not_found");
    const stranger = await createUser();
    expect(await errorOf(rpc(stranger, "start_call", { p_conversation_id: conv }))).toBe("conversation_not_found");
    await rpc(b, "block_user", { p_user_id: a });
    expect(await errorOf(rpc(a, "start_call", { p_conversation_id: conv }))).toBe("user_blocked");
    expect(await errorOf(rpc(a, "calls_cleanup"))).toMatch(/permission denied/);
  });
});
