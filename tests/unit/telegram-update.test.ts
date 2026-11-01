import { describe, expect, it } from "vitest";
import { normalizeCode, readUpdate } from "@/lib/telegram-update";

const ME = 424242;
/** A private-chat message from ME, as Telegram delivers it to the webhook. */
const msg = (extra: Record<string, unknown>) => ({
  update_id: 1,
  message: { message_id: 7, date: 1_700_000_000, chat: { id: ME, type: "private" }, from: { id: ME, is_bot: false, first_name: "Ali" }, ...extra },
});

describe("normalizeCode", () => {
  it("accepts the code with or without its dash, in any case", () => {
    expect(normalizeCode("ABCD-EFGH")).toBe("ABCD-EFGH");
    expect(normalizeCode("abcd-efgh")).toBe("ABCD-EFGH");
    expect(normalizeCode(" abcdefgh ")).toBe("ABCD-EFGH");
    expect(normalizeCode("ABCD EFGH")).toBe("ABCD-EFGH");
    expect(normalizeCode("ABCD_EFGH")).toBe("ABCD-EFGH");
  });
  it("rejects anything else", () => {
    expect(normalizeCode("ABC-EFGH")).toBeNull();
    expect(normalizeCode("ABCD-EFGHI")).toBeNull();
    expect(normalizeCode("رمز")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });
});

describe("readUpdate", () => {
  it("reads the code from the start link", () => {
    expect(readUpdate(msg({ text: "/start ABCD-EFGH" }))).toEqual({ kind: "code", chatId: ME, fromId: ME, code: "ABCD-EFGH" });
    expect(readUpdate(msg({ text: "/start abcdefgh" }))).toMatchObject({ kind: "code", code: "ABCD-EFGH" });
  });

  it("reads a code the user typed, alone or inside other text", () => {
    expect(readUpdate(msg({ text: "abcd-efgh" }))).toMatchObject({ kind: "code", code: "ABCD-EFGH" });
    expect(readUpdate(msg({ text: "رمزي هو ABCD-EFGH شكراً" }))).toMatchObject({ kind: "code", code: "ABCD-EFGH" });
  });

  it("treats a bare /start and other text as something to answer with help", () => {
    expect(readUpdate(msg({ text: "/start" }))).toEqual({ kind: "other", chatId: ME, fromId: ME });
    expect(readUpdate(msg({ text: "مرحبا" }))).toMatchObject({ kind: "other" });
    expect(readUpdate(msg({ sticker: { file_id: "x" } }))).toMatchObject({ kind: "other" });
  });

  it("marks a contact as the sender's own only when its user_id is the sender", () => {
    expect(readUpdate(msg({ contact: { phone_number: "+9647701234567", first_name: "Ali", user_id: ME } }))).toEqual({
      kind: "contact",
      chatId: ME,
      fromId: ME,
      phone: "+9647701234567",
      own: true,
    });
    // Someone else's contact card, or one without a Telegram account behind it.
    expect(readUpdate(msg({ contact: { phone_number: "9647700000000", first_name: "X", user_id: 99 } }))).toMatchObject({ own: false });
    expect(readUpdate(msg({ contact: { phone_number: "9647700000000", first_name: "X" } }))).toMatchObject({ own: false });
  });

  it("ignores what isn't a new private message from a person", () => {
    expect(readUpdate({ update_id: 1, edited_message: msg({ text: "/start ABCD-EFGH" }).message })).toBeNull();
    expect(readUpdate(msg({ chat: { id: -100, type: "group" }, text: "/start ABCD-EFGH" }))).toBeNull();
    expect(readUpdate(msg({ from: { id: ME, is_bot: true }, text: "/start ABCD-EFGH" }))).toBeNull();
    // A forwarded contact is someone else's message, whatever it contains.
    expect(readUpdate(msg({ forward_origin: { type: "user" }, contact: { phone_number: "9647701234567", user_id: ME } }))).toBeNull();
    expect(readUpdate(null)).toBeNull();
    expect(readUpdate("nonsense")).toBeNull();
    expect(readUpdate({ message: { chat: { id: "x", type: "private" }, from: { id: ME }, text: "hi" } })).toBeNull();
  });
});
