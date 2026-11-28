import "server-only";
import { getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/format";
import { logger } from "@/lib/log";
import { notificationArgs, notificationHref } from "@/lib/notifications";
import { apnsConfig, apnsSession, sendApns } from "@/lib/push/apns";
import { fcmConfig, sendFcm } from "@/lib/push/fcm";
import type { PushMessage, PushResult } from "@/lib/push/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sends what waits in the push queue (migration 0051) to the members' phones:
 * Android through Firebase, iPhone through Apple. Called right after a member
 * sends a message, by /api/push (the database's wake-up, when set), and by the
 * scheduled job. Each queued item is handed out once (claim_push_batch), so
 * calls at the same time never send it twice. Best effort, as any push.
 *
 * The texts are the bell's (notifications.*) and, for a message, the sender's
 * name with the message or what it carried, as in the list of conversations.
 */

type Claimed = { kind: string; ref: string; user_id: string; devices: { token: string; platform: "android" | "ios" }[] | null };

const LOCALE = "ar";

/** Whether the site can send to phones at all (FIREBASE_SERVICE_ACCOUNT, or the APNS_* keys). */
export function pushEnabled(): boolean {
  return Boolean(fcmConfig() || apnsConfig());
}
const BATCHES = 5;

export async function drainPush(): Promise<{ sent: number; gone: number; failed: number }> {
  const totals = { sent: 0, gone: 0, failed: 0 };
  const service = createAdminClient();
  if (!service) return totals;
  const fcm = fcmConfig();
  const apns = apnsConfig();
  for (let round = 0; round < BATCHES; round++) {
    const { data, error } = await service.rpc("claim_push_batch", { p_limit: 200 });
    if (error) {
      // Before migration 0051 the function is missing: nothing to send.
      if (error.code !== "PGRST202") logger.error("push_claim_failed", { code: error.code });
      break;
    }
    const batch = (data ?? []) as Claimed[];
    if (!batch.length) break;
    // Without the keys there is nothing to send with: what was claimed is dropped (the scheduled job keeps the queue empty).
    if (!fcm && !apns) continue;
    const messages = await render(service, batch);
    const session = apns && batch.some((b) => b.devices?.some((d) => d.platform === "ios")) ? apnsSession(apns) : null;
    session?.on("error", () => undefined);
    const gone: string[] = [];
    const jobs: (() => Promise<void>)[] = [];
    batch.forEach((item, i) => {
      const message = messages[i];
      if (!message) return;
      for (const device of item.devices ?? []) {
        jobs.push(async () => {
          let result: PushResult = "failed";
          try {
            if (device.platform === "android" && fcm) result = await sendFcm(fcm, device.token, message);
            else if (device.platform === "ios" && apns && session) result = await sendApns(apns, session, device.token, message);
            else return;
          } catch {
            result = "failed";
          }
          totals[result] += 1;
          if (result === "gone") gone.push(device.token);
        });
      }
    });
    // A few at a time.
    for (let i = 0; i < jobs.length; i += 20) await Promise.all(jobs.slice(i, i + 20).map((job) => job()));
    session?.close();
    if (gone.length) await service.rpc("forget_push_tokens", { p_tokens: gone });
  }
  if (totals.failed) logger.warn("push_failed", totals);
  return totals;
}

/** The text for each claimed item (null: nothing to send any more, e.g. the message was deleted). */
async function render(service: NonNullable<ReturnType<typeof createAdminClient>>, batch: Claimed[]): Promise<(PushMessage | null)[]> {
  const notificationIds = batch.filter((b) => b.kind === "notification").map((b) => b.ref);
  const messageIds = batch.filter((b) => b.kind === "message").map((b) => Number(b.ref)).filter(Number.isSafeInteger);
  const [n, m, app, { data: notifications }, { data: messages }] = await Promise.all([
    getTranslations({ locale: LOCALE, namespace: "notifications" }),
    getTranslations({ locale: LOCALE, namespace: "messages" }),
    getTranslations({ locale: LOCALE, namespace: "common" }),
    notificationIds.length ? service.from("notifications").select("id, type, payload").in("id", notificationIds) : Promise.resolve({ data: [] }),
    messageIds.length
      ? service.from("messages").select("id, conversation_id, sender_id, body, image_path, voice_path, video_path, location_lat, deleted_at").in("id", messageIds)
      : Promise.resolve({ data: [] }),
  ]);
  const senderIds = [...new Set((messages ?? []).map((x) => x.sender_id).filter((s): s is string => Boolean(s)))];
  const conversationIds = [...new Set((messages ?? []).map((x) => x.conversation_id))];
  const [{ data: senders }, { data: conversations }] = await Promise.all([
    senderIds.length ? service.from("profiles").select("id, display_name").in("id", senderIds) : Promise.resolve({ data: [] }),
    conversationIds.length ? service.from("conversations").select("*").in("id", conversationIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map((senders ?? []).map((s) => [s.id, s.display_name]));
  const groups = new Map(
    (conversations ?? []).flatMap((c) => {
      const title = (c as { kind: string; title?: string | null }).kind === "group" ? (c as { title?: string | null }).title : null;
      return title ? [[c.id, title] as const] : [];
    }),
  );
  const byNotification = new Map((notifications ?? []).map((x) => [x.id, x]));
  const byMessage = new Map((messages ?? []).map((x) => [String(x.id), x]));
  const appName = app.has("appName") ? app("appName") : "الملعب";
  const fmt = (iso: string) => formatDateTime(iso, LOCALE, "Asia/Baghdad");

  return batch.map((item): PushMessage | null => {
    if (item.kind === "notification") {
      const row = byNotification.get(item.ref);
      if (!row) return null;
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const key = n.has(row.type) ? row.type : "generic";
      return { title: appName, body: n(key, notificationArgs(payload, fmt)), href: notificationHref(row.type, payload), tag: row.type };
    }
    const msg = byMessage.get(item.ref);
    if (!msg || msg.deleted_at) return null;
    const sender = (msg.sender_id && names.get(msg.sender_id)) || appName;
    const group = groups.get(msg.conversation_id);
    const body = msg.location_lat != null
      ? `📍 ${m("location")}`
      : msg.voice_path
        ? `🎤 ${m("voice")}`
        : msg.video_path
          ? `🎥 ${msg.body || m("video")}`
          : msg.image_path && !msg.body
            ? `📷 ${m("photo")}`
            : msg.body;
    return {
      title: group ? `${sender} · ${group}` : sender,
      body: body.length > 180 ? `${body.slice(0, 177)}…` : body,
      href: `/messages/${msg.conversation_id}`,
      tag: `c:${msg.conversation_id}`,
    };
  });
}
