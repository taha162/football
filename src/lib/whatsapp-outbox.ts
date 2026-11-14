import "server-only";
import { publicEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { bot, whatsappConfig, type BotResult } from "@/lib/whatsapp";
import { bookingMessage, promoMessage, type BookingPayload } from "@/lib/whatsapp-messages";

/**
 * The WhatsApp worker. Messages wait in outbound_messages; each run asks the
 * bot what became of the ones it holds, then hands it the next few. The bot
 * paces them (8–25 s apart, hourly and daily caps, "typing…" first), so a
 * run only ever takes seconds. Called by /api/cron, and right after a booking
 * changes or a campaign starts, so messages don't wait for the next run.
 * Nothing here can affect a booking: a failure only delays the WhatsApp copy.
 */

export type Outcome = "accepted" | "later" | "retry" | "failed";

/** What a /send answer means for the message (see wa_outbox_handed). */
export function outcomeOf(res: BotResult<unknown>): Outcome {
  if (res.ok) return "accepted";
  // The bot refused this message itself (a number or text it can't use): trying again won't help.
  if (res.status === 400 || res.status === 422) return "failed";
  // Unreachable, the wrong secret, paused, or its queue is full: nothing was tried; ask again later.
  if (res.status === 0 || res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) return "later";
  return "retry";
}

export interface ClaimedMessage {
  id: string;
  kind: "booking" | "promo";
  phone: string;
  body: string | null;
  payload: Json;
  recipient_name: string | null;
  campaign_body: string | null;
}

/** The text of a claimed message, from its template. Null when it can't be written. */
export function renderMessage(row: ClaimedMessage, siteUrl = publicEnv.siteUrl): string | null {
  if (row.body) return row.body;
  if (row.kind === "promo") return row.campaign_body ? promoMessage({ id: row.id, body: row.campaign_body, name: row.recipient_name }) : null;
  const p = row.payload as unknown as BookingPayload | null;
  return p && p.event && p.venue_name && p.starts_at ? bookingMessage(p, siteUrl) : null;
}

export interface OutboxRun {
  reported: number;
  handed: number;
  held: number;
  failed: number;
  skipped?: "not_configured" | "unavailable";
}

export async function deliverWhatsapp(): Promise<OutboxRun> {
  const run: OutboxRun = { reported: 0, handed: 0, held: 0, failed: 0 };
  if (!whatsappConfig().canSend) return { ...run, skipped: "not_configured" };
  const admin = createAdminClient();
  if (!admin) return { ...run, skipped: "unavailable" };

  // 1. What the bot did with the messages it holds.
  const { data: inFlight, error: inFlightError } = await admin.rpc("wa_outbox_in_flight", { p_limit: 200 });
  if (inFlightError) {
    // Most likely the database update (…0028) isn't applied yet.
    logger.error("whatsapp_outbox_failed", { step: "in_flight", code: inFlightError.code });
    return { ...run, skipped: "unavailable" };
  }
  const ids = (inFlight ?? []) as string[];
  if (ids.length > 0) {
    const status = await bot.status(ids);
    if (status.ok) {
      const results = ids
        .map((id) => ({ id, ...(status.data.results?.[id] ?? { state: "unknown" as const }) }))
        .filter((r) => r.state !== "queued");
      if (results.length > 0) {
        const { error } = await admin.rpc("wa_outbox_delivered", { p_results: results as unknown as Json });
        if (error) logger.error("whatsapp_outbox_failed", { step: "delivered", code: error.code });
        else run.reported = results.length;
      }
    }
  }

  // 2. The next messages: booking messages first, promotions within today's limit.
  const { data: claimed, error: claimError } = await admin.rpc("wa_outbox_claim", {});
  if (claimError) {
    logger.error("whatsapp_outbox_failed", { step: "claim", code: claimError.code });
    return run;
  }
  const handed: { id: string; outcome: Outcome; body?: string; error?: string }[] = [];
  let holdRest = false;
  for (const row of (claimed ?? []) as ClaimedMessage[]) {
    if (holdRest) {
      handed.push({ id: row.id, outcome: "later" });
      continue;
    }
    const text = renderMessage(row);
    if (!text) {
      handed.push({ id: row.id, outcome: "failed", error: "render_failed" });
      continue;
    }
    const res = await bot.send({ id: row.id, to: row.phone, text, kind: row.kind });
    const outcome = outcomeOf(res);
    // The bot is down, paused or full: keep the rest for the next run.
    if (outcome === "later") holdRest = true;
    handed.push({ id: row.id, outcome, body: text, error: res.ok ? undefined : res.error });
  }
  if (handed.length > 0) {
    const { error } = await admin.rpc("wa_outbox_handed", { p_results: handed as unknown as Json });
    if (error) logger.error("whatsapp_outbox_failed", { step: "handed", code: error.code });
  }
  for (const h of handed) {
    if (h.outcome === "accepted") run.handed++;
    else if (h.outcome === "failed") run.failed++;
    else run.held++;
  }
  if (holdRest) logger.warn("whatsapp_bot_unavailable", { reason: handed.find((h) => h.outcome === "later")?.error ?? "unknown" });
  return run;
}
