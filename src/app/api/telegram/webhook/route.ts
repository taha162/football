import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretMatches, telegramConfig } from "@/lib/telegram";
import { readUpdate } from "@/lib/telegram-update";

export const dynamic = "force-dynamic";

const SHARE_BUTTON = "📱 مشاركة رقمي";
const SHARE_KEYBOARD = { keyboard: [[{ text: SHARE_BUTTON, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
const NO_KEYBOARD = { remove_keyboard: true };

// The site is Arabic only, and so is the bot.
const TEXT = {
  share: "أهلاً في «الملعب» 👋\nاضغط الزر بالأسفل «مشاركة رقمي» لتأكيد رقمك.",
  shareOwn: "⚠️ شارك رقمك أنت عبر زر «مشاركة رقمي» بالأسفل.",
  noCode: "⚠️ هذا الرمز غير صالح أو انتهت صلاحيته. ارجع إلى الموقع وابدأ من جديد.",
  claimed: "⚠️ هذا الرمز يستخدمه حساب تيليغرام آخر. ارجع إلى الموقع وابدأ من جديد.",
  tooMany: "⚠️ محاولات كثيرة. حاول مرة أخرى بعد ساعة.",
  openLinkFirst: "⚠️ افتح رابط تيليغرام من صفحة التأكيد في الموقع أولاً، أو أرسل هنا الرمز الظاهر فيها.",
  badPhone: "⚠️ تعذّرت قراءة الرقم. حاول مرة أخرى.",
  help: "هذا بوت التحقق لموقع «الملعب». ابدأ من الموقع: أنشئ حساباً أو استرجع كلمة المرور عبر تيليغرام.",
  "signup:verified": "✅ تم تأكيد رقمك. ارجع إلى الموقع لإكمال حسابك.",
  "signup:phone_taken": "⚠️ هذا الرقم مرتبط بحساب آخر في «الملعب». سجّل الدخول به بدل إنشاء حساب جديد.",
  "reset:verified": "✅ تم التحقق. ارجع إلى «الملعب» لاختيار كلمة مرور جديدة.",
  "reset:no_account": "⚠️ لا يوجد حساب في «الملعب» مرتبط بهذا الرقم.",
} as const;

/** Answers the update in the webhook response itself (no outgoing call to Telegram). */
function reply(chatId: number, text: string, markup: object = NO_KEYBOARD) {
  return NextResponse.json({ method: "sendMessage", chat_id: chatId, text, reply_markup: markup });
}

/** Updates from the bot. Only requests carrying the webhook's secret token are processed. */
export async function POST(request: NextRequest) {
  const cfg = telegramConfig();
  if (!cfg.enabled || !secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), cfg.token)) {
    // Telegram always sends the secret: a request without the right one didn't come from it.
    if (cfg.enabled) logger.warn("telegram_webhook_rejected", { withHeader: request.headers.has("x-telegram-bot-api-secret-token") });
    return new NextResponse("unauthorized", { status: 401 });
  }
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  const input = readUpdate(update);
  // Edits, group messages, forwards and other updates are acknowledged and ignored.
  if (!input) return NextResponse.json({ ok: true });
  const admin = createAdminClient();
  if (!admin) return new NextResponse("unavailable", { status: 503 });

  if (input.kind === "code") {
    const { data, error } = await admin.rpc("tg_link_code", { p_code: input.code, p_tg_user_id: input.fromId });
    if (error) {
      logger.error("telegram_link_failed", { code: error.code });
      // Non-2xx makes Telegram deliver the update again later; linking is idempotent.
      return new NextResponse("error", { status: 500 });
    }
    const result = data as { linked?: boolean; reason?: string };
    if (result.linked) return reply(input.chatId, TEXT.share, SHARE_KEYBOARD);
    return reply(input.chatId, result.reason === "claimed" ? TEXT.claimed : result.reason === "rate_limited" ? TEXT.tooMany : TEXT.noCode);
  }

  if (input.kind === "contact") {
    // Only the sender's own contact proves the number (not a contact card of someone else).
    if (!input.own) return reply(input.chatId, TEXT.shareOwn, SHARE_KEYBOARD);
    const { data, error } = await admin.rpc("tg_receive_contact", { p_tg_user_id: input.fromId, p_phone: input.phone });
    if (error) {
      logger.error("telegram_contact_failed", { code: error.code });
      return new NextResponse("error", { status: 500 });
    }
    const result = data as { matched?: boolean; reason?: string; purpose?: string; status?: string };
    if (!result.matched) return reply(input.chatId, result.reason === "invalid_phone" ? TEXT.badPhone : TEXT.openLinkFirst);
    const text = TEXT[`${result.purpose}:${result.status}` as keyof typeof TEXT];
    return reply(input.chatId, text ?? TEXT.help);
  }

  return reply(input.chatId, TEXT.help);
}
