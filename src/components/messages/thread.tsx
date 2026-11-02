"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneIncoming, PhoneMissed } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ReportButton } from "@/components/report-button";
import { prefersReducedMotion } from "@/components/motion/scroll";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient, getRealtimeClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/duration";
import { markConversationReadAction } from "@/server/messages";
import { Composer } from "./composer";
import { LocationCard } from "./location-card";
import { VoiceNote } from "./voice-note";

export interface ThreadMessage {
  id: number;
  sender_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  image_path?: string | null;
  /** Short-lived signed link to the picture, when there is one. */
  image_url?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_accuracy?: number | null;
  voice_path?: string | null;
  voice_seconds?: number | null;
  /** Short-lived signed link to the voice note, when there is one. */
  voice_url?: string | null;
  call_outcome?: string | null;
  call_seconds?: number | null;
}

/**
 * Message thread. Initial history is server-rendered; new messages arrive via
 * Supabase Realtime (postgres_changes on `messages`, filtered by RLS so only
 * members receive them). Without realtime, the page still works by reloading.
 */
export function Thread({
  conversationId,
  me,
  names,
  initial,
  locked,
  timeZone,
}: {
  conversationId: string;
  me: string;
  names: Record<string, string>;
  initial: ThreadMessage[];
  locked: boolean;
  timeZone: string;
}) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const [messages, setMessages] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  const list = useRef<HTMLOListElement>(null);
  const opened = useRef(false);

  // Server re-render (e.g. after sending) brings fresh history: merge by id
  // so realtime-delivered messages aren't lost (derived-state pattern).
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setMessages((prev) => {
      const byId = new Map([...initial, ...prev].map((m) => [m.id, m]));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  }

  useEffect(() => {
    void markConversationReadAction(conversationId);
    let channel: RealtimeChannel | null = null;
    let closed = false;
    // Joined as the member (RLS decides what reaches them), once the session has loaded.
    void getRealtimeClient().then((supabase) => {
      if (closed) return;
      channel = supabase
        .channel(`conversation:${conversationId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          async (payload) => {
            const msg = payload.new as ThreadMessage;
            // Live messages carry the files' paths only; sign them with the member's session.
            if (msg.image_path && !msg.image_url) {
              const { data } = await supabase.storage.from("message-images").createSignedUrl(msg.image_path, 3600);
              msg.image_url = data?.signedUrl ?? null;
            }
            if (msg.voice_path && !msg.voice_url) {
              const { data } = await supabase.storage.from("message-voice").createSignedUrl(msg.voice_path, 3600);
              msg.voice_url = data?.signedUrl ?? null;
            }
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            void markConversationReadAction(conversationId);
          },
        )
        .subscribe();
    });
    return () => {
      closed = true;
      if (channel) void getBrowserClient().removeChannel(channel);
    };
  }, [conversationId]);

  // The newest message is at the bottom: open there, then glide down to each
  // new one. Only the list scrolls, so the composer stays where it is.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: opened.current && !prefersReducedMotion() ? "smooth" : "auto" });
    opened.current = true;
  }, [messages.length]);

  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { timeZone, hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-4">
      <ol ref={list} className="flex max-h-[60vh] min-h-64 flex-col gap-3 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-live="polite" aria-label={t("history")}>
        {messages.length === 0 ? <li className="m-auto text-sm text-muted">{t("noMessages")}</li> : null}
        {messages.map((m) => {
          const mine = m.sender_id === me;
          const time = <time className="text-[11px] text-faint" dateTime={m.created_at}>{fmt.format(new Date(m.created_at))}</time>;
          // A call's record sits in the middle: it belongs to both.
          if (m.call_outcome && !m.deleted_at) {
            const answered = m.call_outcome === "answered";
            const Icon = answered ? (mine ? Phone : PhoneIncoming) : PhoneMissed;
            return (
              <li key={m.id} className="flex flex-col items-center gap-1 self-center" data-testid="call-line">
                <span className={cn("flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold", !answered && !mine ? "text-danger" : "text-muted")}>
                  <Icon aria-hidden="true" className="size-3.5" />
                  {answered ? t("callAnswered", { duration: formatDuration(m.call_seconds ?? 0, locale) }) : mine ? t("callNoAnswer") : t("callMissed")}
                </span>
                {time}
              </li>
            );
          }
          const hasLocation = m.location_lat != null && m.location_lng != null && !m.deleted_at;
          return (
            <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-1", mine ? "self-end items-end" : "self-start items-start")}>
              {!mine ? <span className="text-xs text-muted">{m.sender_id ? (names[m.sender_id] ?? t("member")) : t("deletedUser")}</span> : null}
              {m.image_url && !m.deleted_at ? (
                <a href={m.image_url} target="_blank" rel="noopener noreferrer" aria-label={t("openImage")} className="block overflow-hidden rounded-2xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, signed, short-lived link */}
                  <img src={m.image_url} alt={t("imageAlt")} loading="lazy" className="max-h-72 w-auto max-w-full object-contain" />
                </a>
              ) : null}
              {hasLocation ? <LocationCard lat={m.location_lat!} lng={m.location_lng!} accuracy={m.location_accuracy ?? null} /> : null}
              {m.voice_path && !m.deleted_at ? <VoiceNote src={m.voice_url ?? null} seconds={m.voice_seconds ?? 1} mine={mine} /> : null}
              {m.deleted_at || m.body ? (
                <div className={cn("whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink", m.deleted_at && "italic opacity-60")} dir="auto">
                  {m.deleted_at ? t("deleted") : m.body}
                </div>
              ) : null}
              <div className="flex items-center gap-1">
                {time}
                {!mine && !m.deleted_at ? <ReportButton targetType="message" targetId={String(m.id)} compact /> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {locked ? (
        <p className="text-sm text-muted">{t("lockedNote")}</p>
      ) : (
        <Composer conversationId={conversationId} />
      )}
    </div>
  );
}
