import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  bookingLink,
  bookingMessage,
  findCode,
  HELP_REPLY,
  isStopKeyword,
  NO_TYPED_NUMBER_REPLY,
  otherNumberReply,
  PROMO_STOP_LINE,
  promoMessage,
  STOPPED_REPLY,
  verificationReply,
} = await import("@/lib/whatsapp-messages");
const { readWhatsappSettings } = await import("@/lib/whatsapp-settings");
const { outcomeOf, renderMessage } = await import("@/lib/whatsapp-outbox");

const SITE = "https://al-malab.example";
// Thursday 19 November 2026, 20:00–21:00 in Baghdad (17:00–18:00 UTC).
const booking = {
  event: "confirmed" as const,
  booking_id: "b6f0a9d2-0000-4000-8000-000000000001",
  venue_name: "ملعب الشباب",
  field_name: null,
  starts_at: "2026-11-19T17:00:00+00:00",
  ends_at: "2026-11-19T18:00:00+00:00",
  price_total: 30_000,
  currency: "IQD",
  deposit_amount: 5000,
  deposit_status: "received",
  by_customer: false,
};
const ar = (n: number) => new Intl.NumberFormat("ar-IQ").format(n);

describe("WhatsApp booking messages", () => {
  it("a confirmation names the venue, the time in Iraq, the price and deposit, and links to the booking", () => {
    const text = bookingMessage(booking, SITE);
    expect(text).toContain("✅ تأكّد حجزك في «ملعب الشباب»");
    expect(text).toContain("الخميس");
    expect(text).toContain("تشرين الثاني");
    expect(text).toContain(`${ar(8)}:${ar(0)}${ar(0)}`); // 8:00 in the evening, Baghdad time (UTC 17:00)
    expect(text).toContain("بتوقيت العراق");
    expect(text).toContain(`${ar(30)}٬${ar(0).repeat(3)}`); // 30,000
    expect(text).toContain(`عربون ${new Intl.NumberFormat("ar-IQ", { style: "currency", currency: "IQD", maximumFractionDigits: 0 }).format(5000)}`);
    expect(text).toContain("والباقي");
    expect(text).toContain(`${SITE}/ar/my/bookings#booking-${booking.booking_id}`);
    expect(text.split("\n").at(-1)).toBe("— «الملعب»");
  });

  it("says nothing about money for a free booking, and names the court only when the venue has several", () => {
    const free = bookingMessage({ ...booking, price_total: 0, deposit_amount: null, deposit_status: null }, SITE);
    expect(free).not.toContain("💵");
    const noDeposit = bookingMessage({ ...booking, deposit_amount: null, deposit_status: null }, SITE);
    expect(noDeposit).toContain("يُدفع في الملعب");
    expect(noDeposit).not.toContain("عربون");
    expect(bookingMessage({ ...booking, field_name: "الملعب ٢" }, SITE)).toContain("«ملعب الشباب» – الملعب ٢");
  });

  it("a change gives the new time; a cancellation says who cancelled and whether a deposit is owed back", () => {
    expect(bookingMessage({ ...booking, event: "changed" }, SITE)).toMatch(/^🔁 تغيّر موعد حجزك في «ملعب الشباب»\n🗓️ الموعد الجديد: /);
    const byVenue = bookingMessage({ ...booking, event: "cancelled", deposit_status: "refund_due" }, SITE);
    expect(byVenue).toMatch(/^❌ أُلغي حجزك في «ملعب الشباب»\./);
    expect(byVenue).toContain("على الملعب أن يعيد لك العربون");
    const byCustomer = bookingMessage({ ...booking, event: "cancelled", by_customer: true, deposit_status: "forfeited" }, SITE);
    expect(byCustomer).toContain("كما طلبت");
    expect(byCustomer).not.toContain("يعيد لك");
    expect(bookingLink(SITE, "abc")).toBe(`${SITE}/ar/my/bookings#booking-abc`);
  });
});

describe("WhatsApp promotions", () => {
  it("greet the recipient by first name, vary the greeting a little, and end with how to stop", () => {
    const text = promoMessage({ id: "m-1", body: "  خصم ٢٠٪ على حجوزات الصباح  ", name: "Ahmed Ali" });
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^(مرحباً|أهلاً|هلا) Ahmed،$/);
    expect(lines[1]).toBe("خصم ٢٠٪ على حجوزات الصباح");
    expect(lines.at(-1)).toBe(PROMO_STOP_LINE);
    expect(PROMO_STOP_LINE).toContain("أرسل 0");
    // The same message keeps its greeting; different messages don't all share one.
    expect(promoMessage({ id: "m-1", body: "x", name: "A" })).toBe(promoMessage({ id: "m-1", body: "x", name: "A" }));
    const greetings = new Set(Array.from({ length: 30 }, (_, i) => promoMessage({ id: `id-${i}`, body: "x", name: "A" }).split(" ")[0]));
    expect(greetings.size).toBeGreaterThan(1);
    expect(promoMessage({ id: "m-2", body: "x", name: null }).split("\n")[0]).toMatch(/^(مرحباً|أهلاً|هلا)،$/);
  });
});

describe("WhatsApp replies to people who write", () => {
  it("answer every outcome of a code, and fall back to the help text", () => {
    expect(verificationReply({ matched: true, purpose: "signup", status: "verified" })).toContain("تم تأكيد رقمك");
    expect(verificationReply({ matched: true, purpose: "signup", status: "phone_taken" })).toContain("مرتبط بحساب آخر");
    expect(verificationReply({ matched: true, purpose: "reset", status: "verified" })).toContain("كلمة مرور جديدة");
    expect(verificationReply({ matched: true, purpose: "reset", status: "no_account" })).toContain("لا يوجد حساب");
    expect(verificationReply({ matched: false, reason: "no_pending_code" })).toContain("غير صالح");
    // Opened in Telegram before Telegram sign-up was removed: start again, without sending anyone to Telegram.
    expect(verificationReply({ matched: false, reason: "claimed" })).toContain("ابدأ من جديد");
    expect(verificationReply({ matched: false, reason: "claimed" })).not.toContain("تيليغرام");
    expect(verificationReply({ matched: false, reason: "rate_limited" })).toContain("بعد ساعة");
    expect(verificationReply({ matched: false, reason: "no_code" })).toBe(HELP_REPLY);
    expect(verificationReply(null)).toBe(HELP_REPLY);
    expect(STOPPED_REPLY).toContain("لن تصلك أي رسالة");
  });

  it("a code sent from another number than the typed one names that number, partly hidden", () => {
    const reply = verificationReply({ matched: false, reason: "other_number", claimed: "9647701234567" });
    expect(reply).toContain("⁦+964 770 ••• 4567⁩");
    expect(reply).not.toContain("123");
    // Without a usable number it is just the help text, never a broken sentence.
    expect(verificationReply({ matched: false, reason: "other_number" })).toBe(HELP_REPLY);
  });

  it("the bot and the site say the same words (they are separate services and can't share the file)", async () => {
    const bot = await import("../../whatsapp-bot/src/config.mjs");
    const { maskPhone } = await import("../../whatsapp-bot/src/inbound.mjs");
    expect(bot.OTHER_NUMBER.replace("{number}", maskPhone("9647701234567"))).toBe(otherNumberReply("9647701234567"));
    expect(bot.NO_NUMBER_CODE).toBe(NO_TYPED_NUMBER_REPLY);
    expect(bot.DEFAULT_HELP).toBe(HELP_REPLY);
  });

  it("read codes and stop words the same way as the bot (one shared file)", () => {
    expect(findCode("رمزي abcd efgh")).toBe("ABCD-EFGH");
    expect(isStopKeyword("إلغاء")).toBe(true);
    expect(isStopKeyword("بدي الغي الحجز")).toBe(false);
  });
});

describe("the WhatsApp settings pasted into Vercel", () => {
  it("accept the number in any usual form and keep only the bot's origin", () => {
    const secret = "a".repeat(32);
    for (const number of ["+964 770 123 4567", "07701234567", "009647701234567", "https://wa.me/9647701234567", "٠٧٧٠١٢٣٤٥٦٧"]) {
      expect(readWhatsappSettings(secret, number, "https://bot.example/send").number).toBe("9647701234567");
    }
    expect(readWhatsappSettings(secret, "07701234567", "https://bot.example/path?x=1")).toEqual({
      secret,
      number: "9647701234567",
      url: "https://bot.example",
      problems: [],
    });
    expect(readWhatsappSettings(secret, "07701234567", "bot.example").url).toBe("https://bot.example");
  });

  it("name each problem: missing or short secret, bad number, missing or plain-http address", () => {
    expect(readWhatsappSettings("", "", "").problems).toEqual(["secret_missing", "number_missing", "url_missing"]);
    expect(readWhatsappSettings("short", "12", "http://bot.example").problems).toEqual(["secret_short", "number_invalid", "url_insecure"]);
    // The secret travels with every request: plain http only to this machine.
    expect(readWhatsappSettings("a".repeat(40), "07701234567", "http://localhost:8080").problems).toEqual([]);
    expect(readWhatsappSettings(`${"a".repeat(31)} b`, "07701234567", "https://x.example").problems).toEqual(["secret_short"]);
  });
});

describe("the WhatsApp worker", () => {
  it("reads the bot's answer to /send", () => {
    expect(outcomeOf({ ok: true, status: 202, data: {} })).toBe("accepted");
    expect(outcomeOf({ ok: false, status: 400, error: "invalid_number" })).toBe("failed");
    // Not tried at all: no attempt is used up.
    for (const status of [0, 401, 429, 503]) expect(outcomeOf({ ok: false, status, error: "x" })).toBe("later");
    expect(outcomeOf({ ok: false, status: 500, error: "internal" })).toBe("retry");
  });

  it("writes each message from its template, or keeps the text it already has", () => {
    const base = { id: "m-9", phone: "9647701234567", recipient_name: "Sara", campaign_body: null, body: null };
    expect(renderMessage({ ...base, kind: "booking", payload: booking }, SITE)).toBe(bookingMessage(booking, SITE));
    expect(renderMessage({ ...base, kind: "promo", payload: {}, campaign_body: "عرض" }, SITE)).toBe(promoMessage({ id: "m-9", body: "عرض", name: "Sara" }));
    expect(renderMessage({ ...base, kind: "booking", payload: booking, body: "as sent" }, SITE)).toBe("as sent");
    expect(renderMessage({ ...base, kind: "booking", payload: {} }, SITE)).toBeNull();
    expect(renderMessage({ ...base, kind: "promo", payload: {} }, SITE)).toBeNull();
  });
});
