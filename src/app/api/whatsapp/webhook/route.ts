import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { inboundTexts, sendWhatsappText, verifySignature, whatsappConfig } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** Meta's one-time webhook verification handshake. */
export async function GET(request: NextRequest) {
  const cfg = whatsappConfig();
  const sp = request.nextUrl.searchParams;
  if (cfg.verifyToken && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === cfg.verifyToken) {
    return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

const REPLIES: Record<string, string> = {
  "signup:verified": "✅ تم تأكيد رقمك في ملعب. ارجع إلى الموقع لإكمال حسابك.\n✅ Your number is verified on Malaab. Go back to the site to continue.",
  "signup:phone_taken": "⚠️ هذا الرقم مرتبط بحساب آخر في ملعب. سجّل الدخول به بدل إنشاء حساب جديد.\n⚠️ This number already has a Malaab account. Sign in instead.",
  "reset:verified": "✅ تم التحقق. ارجع إلى ملعب لاختيار كلمة مرور جديدة.\n✅ Verified. Go back to Malaab to choose a new password.",
  "reset:no_account": "⚠️ لا يوجد حساب في ملعب مرتبط بهذا الرقم.\n⚠️ No Malaab account is linked to this number.",
};

/** Inbound messages. Only signed requests from Meta are processed. */
export async function POST(request: NextRequest) {
  const cfg = whatsappConfig();
  const raw = await request.text();
  if (!cfg.enabled || !verifySignature(raw, request.headers.get("x-hub-signature-256"), cfg.appSecret)) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  const admin = createAdminClient();
  if (!admin) return new NextResponse("unavailable", { status: 503 });

  for (const msg of inboundTexts(payload)) {
    const { data, error } = await admin.rpc("wa_receive", { p_from: msg.from, p_body: msg.body, p_message_id: msg.id });
    if (error) {
      logger.error("whatsapp_receive_failed", { code: error.code });
      // Non-2xx makes Meta retry later; wa_receive is idempotent per message id.
      return new NextResponse("error", { status: 500 });
    }
    const result = data as { matched?: boolean; purpose?: string; status?: string };
    if (result?.matched) {
      const reply = REPLIES[`${result.purpose}:${result.status}`];
      if (reply) await sendWhatsappText(msg.from, reply);
    }
  }
  // Status updates and other events are acknowledged and ignored.
  return NextResponse.json({ ok: true });
}
