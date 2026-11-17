import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/log";
import { API_LIMITS, hit, limitAddress, spent, tooManyRequests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { bearerMatches, whatsappConfig } from "@/lib/whatsapp";
import { isStopKeyword, NO_TYPED_NUMBER_REPLY, STOPPED_REPLY, verificationReply, type ReceiveResult } from "@/lib/whatsapp-messages";

export const dynamic = "force-dynamic";

/**
 * What the bot forwards: the text, with either the sender's real number
 * (WhatsApp showed it, or the bot resolved its LID), or `hidden: true` when
 * WhatsApp hides it. For a hidden sender the site answers with the number
 * typed for that code (`check`); the bot asks WhatsApp whether the sender is
 * that number and, only if so, sends the message again with it.
 */
const Inbound = z.union([
  z.object({ from: z.string().trim().regex(/^\+?[1-9][0-9]{7,14}$/), text: z.string().max(500) }),
  z.object({ hidden: z.literal(true), text: z.string().max(500) }),
]);

/**
 * The bot's check that SITE_URL leads here and that the secret is the same
 * (it shows in Admin → Settings). Nothing is read or written.
 */
export async function GET(request: NextRequest) {
  const cfg = whatsappConfig();
  const address = limitAddress(request.headers);
  const blocked = spent(API_LIMITS.badSecret, address);
  if (!blocked.ok) return tooManyRequests(blocked.retryAfter);
  if (!cfg.enabled || !bearerMatches(request.headers.get("authorization"), cfg.secret)) {
    hit(API_LIMITS.badSecret, address);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Messages from the WhatsApp bot (whatsapp-bot/). It forwards only those that
 * carry a code or ask to stop messages, and sends the sender the `reply`.
 * Only requests with `Authorization: Bearer WHATSAPP_BOT_SECRET` are read.
 */
export async function POST(request: NextRequest) {
  const cfg = whatsappConfig();
  // Wrong secrets are limited per address (the bot always has the right one, and isn't limited).
  const address = limitAddress(request.headers);
  const blocked = spent(API_LIMITS.badSecret, address);
  if (!blocked.ok) return tooManyRequests(blocked.retryAfter);
  if (!cfg.enabled || !bearerMatches(request.headers.get("authorization"), cfg.secret)) {
    hit(API_LIMITS.badSecret, address);
    if (cfg.enabled) logger.warn("whatsapp_webhook_rejected", { withHeader: request.headers.has("authorization") });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = Inbound.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  if ("hidden" in parsed.data) {
    const { data, error } = await admin.rpc("wa_bot_claimed_phone", { p_body: parsed.data.text });
    if (error) {
      logger.error("whatsapp_claim_failed", { code: error.code });
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    const claim = (data ?? {}) as { found?: boolean; phone?: string | null; reason?: string };
    if (claim.found && claim.phone) return NextResponse.json({ check: claim.phone });
    if (claim.found && claim.reason === "claimed") return NextResponse.json({ reply: verificationReply({ reason: "claimed" }), reason: "claimed" });
    if (claim.found) return NextResponse.json({ reply: NO_TYPED_NUMBER_REPLY, reason: "no_typed_number" });
    return NextResponse.json({ reply: verificationReply({ reason: "no_pending_code" }), reason: "no_pending_code" });
  }
  const { from, text } = parsed.data;

  if (isStopKeyword(text)) {
    const { error } = await admin.rpc("wa_bot_unsubscribe", { p_phone: from });
    if (error) {
      logger.error("whatsapp_unsubscribe_failed", { code: error.code });
      // The bot tries again; recording the opt-out is idempotent.
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    logger.info("whatsapp_unsubscribed");
    return NextResponse.json({ reply: STOPPED_REPLY });
  }

  const { data, error } = await admin.rpc("wa_bot_receive", { p_phone: from, p_body: text });
  if (error) {
    logger.error("whatsapp_receive_failed", { code: error.code });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ reply: verificationReply(data as ReceiveResult) });
}
