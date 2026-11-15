/**
 * The words the WhatsApp bot sends for the site: answers to codes, booking
 * messages and promotions. The site is Arabic only, and so is the bot. Pure,
 * so it is unit-tested; times are shown in Iraq time.
 */
import { formatMoney } from "@/lib/domain/money";

export { findCode, isStopKeyword } from "../../whatsapp-bot/src/text.mjs";

const TZ = "Asia/Baghdad";
const day = (iso: string) => new Intl.DateTimeFormat("ar-IQ", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const clock = (iso: string) => new Intl.DateTimeFormat("ar-IQ", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const money = (amount: number, currency: string) => formatMoney(amount, currency, "ar");

export const BRAND_LINE = "— «الملعب»";

// ---- Answers to the codes people send ----------------------------------------

export type ReceiveResult = { matched?: boolean; reason?: string; purpose?: string; status?: string; claimed?: string } | null | undefined;

/** "+964 770 ••• 4567", kept left-to-right inside Arabic text. */
const masked = (phone: string) => `⁦+${phone.slice(0, 3)} ${phone.slice(3, 6)} ••• ${phone.slice(-4)}⁩`;

/** A code requested for another number than the sender's (the bot sends the same words). */
export const otherNumberReply = (claimed: string) =>
  `⚠️ هذا الرمز طُلب للرقم ${masked(claimed)}، لكن رسالتك ليست من واتساب هذا الرقم. أرسله من واتساب الرقم الذي كتبته، أو ابدأ من جديد في الموقع واكتب رقمك الصحيح.`;

/** A hidden sender (WhatsApp shows no number) with a code requested without a typed number. */
export const NO_TYPED_NUMBER_REPLY =
  "لم يظهر لنا رقم هاتفك في هذه المحادثة. ابدأ من جديد في الموقع واكتب رقمك، ثم أرسل الرمز الجديد من واتساب هذا الرقم.";

const REPLIES: Record<string, string> = {
  "signup:verified": "✅ تم تأكيد رقمك. ارجع إلى الموقع لإكمال حسابك.",
  "signup:phone_taken": "⚠️ هذا الرقم مرتبط بحساب آخر في «الملعب». سجّل الدخول به بدل إنشاء حساب جديد.",
  "reset:verified": "✅ تم التحقق. ارجع إلى «الملعب» لاختيار كلمة مرور جديدة.",
  "reset:no_account": "⚠️ لا يوجد حساب في «الملعب» مرتبط بهذا الرقم.",
  no_pending_code: "⚠️ هذا الرمز غير صالح أو انتهت صلاحيته. ارجع إلى الموقع وابدأ من جديد.",
  // A code opened in Telegram before Telegram sign-up was removed: it can't be finished there any more.
  claimed: "⚠️ هذا الرمز لم يعد صالحاً. ارجع إلى الموقع وابدأ من جديد.",
  rate_limited: "⚠️ محاولات كثيرة. حاول مرة أخرى بعد ساعة.",
};

export const HELP_REPLY =
  "هذا رقم «الملعب» للتحقق ورسائل الحجوزات. لإنشاء حساب أو استعادة كلمة المرور ابدأ من الموقع، ثم أرسل هنا الرمز الذي يظهر لك.";

export const STOPPED_REPLY =
  "تم. لن تصلك أي رسالة من «الملعب» على واتساب بعد الآن. يمكنك إعادة تفعيلها من الإعدادات في الموقع. لإلغاء حجز افتحه في الموقع.";

/** The reply to a message that carried a code (wa_bot_receive's answer). */
export function verificationReply(result: ReceiveResult): string {
  if (result?.matched) return REPLIES[`${result.purpose}:${result.status}`] ?? HELP_REPLY;
  if (result?.reason === "other_number" && result.claimed && /^[1-9][0-9]{7,14}$/.test(result.claimed)) return otherNumberReply(result.claimed);
  return REPLIES[result?.reason ?? ""] ?? HELP_REPLY;
}

// ---- Booking messages ---------------------------------------------------------

export interface BookingPayload {
  event: "confirmed" | "changed" | "cancelled";
  booking_id: string;
  venue_name: string;
  field_name?: string | null;
  starts_at: string;
  ends_at: string;
  price_total: number;
  currency: string;
  deposit_amount?: number | null;
  deposit_status?: string | null;
  by_customer?: boolean;
}

/** The booking on the site (its row in My bookings). */
export const bookingLink = (siteUrl: string, bookingId: string) => `${siteUrl}/ar/my/bookings#booking-${bookingId}`;

export function bookingMessage(p: BookingPayload, siteUrl: string): string {
  const where = `«${p.venue_name}»${p.field_name ? ` – ${p.field_name}` : ""}`;
  const when = `${day(p.starts_at)}، ${clock(p.starts_at)} – ${clock(p.ends_at)}`;
  const link = `تفاصيل الحجز: ${bookingLink(siteUrl, p.booking_id)}`;
  const deposit = p.deposit_amount && p.deposit_amount > 0 ? p.deposit_amount : 0;

  if (p.event === "cancelled") {
    const lines = [
      p.by_customer ? `❌ تم إلغاء حجزك في ${where} كما طلبت.` : `❌ أُلغي حجزك في ${where}.`,
      `🗓️ كان الموعد: ${when}`,
    ];
    if (deposit && p.deposit_status === "refund_due") lines.push(`💵 على الملعب أن يعيد لك العربون (${money(deposit, p.currency)}).`);
    return [...lines, link, BRAND_LINE].join("\n");
  }

  if (p.event === "changed") {
    return [`🔁 تغيّر موعد حجزك في ${where}`, `🗓️ الموعد الجديد: ${when} (بتوقيت العراق)`, link, BRAND_LINE].join("\n");
  }

  const lines = [`✅ تأكّد حجزك في ${where}`, `🗓️ ${when} (بتوقيت العراق)`];
  if (p.price_total > 0) {
    lines.push(
      deposit
        ? `💵 السعر ${money(p.price_total, p.currency)}، دفعت منه عربون ${money(deposit, p.currency)}، والباقي ${money(Math.max(p.price_total - deposit, 0), p.currency)} في الملعب`
        : `💵 السعر ${money(p.price_total, p.currency)}، يُدفع في الملعب`,
    );
  }
  return [...lines, link, BRAND_LINE].join("\n");
}

// ---- Promotions ---------------------------------------------------------------

export const PROMO_STOP_LINE = "لإيقاف هذه الرسائل أرسل 0";
const GREETINGS = ["مرحباً", "أهلاً", "هلا"];

/** A stable small number from the message id, so each message keeps its greeting. */
function pick(id: string, n: number): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

/**
 * A promotional message: a greeting with the recipient's first name (it
 * varies a little from one message to the next), the admin's text, and the
 * line that says how to stop them.
 */
export function promoMessage({ id, body, name }: { id: string; body: string; name?: string | null }): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const greeting = GREETINGS[pick(id, GREETINGS.length)];
  return [`${greeting}${first ? ` ${first}` : ""}،`, body.trim(), "", BRAND_LINE, PROMO_STOP_LINE].join("\n");
}
