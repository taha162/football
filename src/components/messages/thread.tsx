"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/field";
import { ReportButton } from "@/components/report-button";
import { getBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { markConversationReadAction, sendMessageAction } from "@/server/messages";

export interface ThreadMessage {
  id: number;
  sender_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
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
  const bottom = useRef<HTMLLIElement>(null);

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
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const msg = payload.new as ThreadMessage;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          void markConversationReadAction(conversationId);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { timeZone, hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex max-h-[60vh] min-h-64 flex-col gap-3 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-live="polite" aria-label={t("history")}>
        {messages.length === 0 ? <li className="m-auto text-sm text-muted">{t("noMessages")}</li> : null}
        {messages.map((m) => {
          const mine = m.sender_id === me;
          return (
            <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-1", mine ? "self-end items-end" : "self-start items-start")}>
              {!mine ? <span className="text-xs text-muted">{m.sender_id ? (names[m.sender_id] ?? t("member")) : t("deletedUser")}</span> : null}
              <div className={cn("whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink", m.deleted_at && "italic opacity-60")} dir="auto">
                {m.deleted_at ? t("deleted") : m.body}
              </div>
              <div className="flex items-center gap-1">
                <time className="text-[11px] text-faint" dateTime={m.created_at}>{fmt.format(new Date(m.created_at))}</time>
                {!mine && !m.deleted_at ? <ReportButton targetType="message" targetId={String(m.id)} compact /> : null}
              </div>
            </li>
          );
        })}
        <li ref={bottom} aria-hidden="true" />
      </ol>
      {locked ? (
        <p className="text-sm text-muted">{t("lockedNote")}</p>
      ) : (
        <ActionForm action={sendMessageAction} resetOnSuccess hideSuccess className="gap-2">
          <Hidden values={{ conversation_id: conversationId }} />
          <label htmlFor="message-body" className="sr-only">{t("write")}</label>
          <Textarea id="message-body" name="body" required maxLength={2000} placeholder={t("placeholder")} className="min-h-20" dir="auto" />
          <SubmitButton className="self-end">{t("send")}</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
