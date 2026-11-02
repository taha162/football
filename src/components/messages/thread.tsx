"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, Hidden, SubmitButton } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/field";
import { ReportButton } from "@/components/report-button";
import { prefersReducedMotion } from "@/components/motion/scroll";
import { getBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { markConversationReadAction, sendMessageAction } from "@/server/messages";

export interface ThreadMessage {
  id: number;
  sender_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  image_path?: string | null;
  /** Short-lived signed link to the picture, when there is one. */
  image_url?: string | null;
}

const MAX_SIDE = 1600;

/**
 * Phone photos are often several megabytes: shrink to at most 1600 px on the
 * long side as JPEG before sending (faster on mobile data, and under the 5 MB
 * limit). Falls back to the original file if the browser can't decode it.
 */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
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
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const msg = payload.new as ThreadMessage;
          // Live messages carry the picture's path only; sign it with the member's session.
          if (msg.image_path && !msg.image_url) {
            const { data } = await supabase.storage.from("message-images").createSignedUrl(msg.image_path, 3600);
            msg.image_url = data?.signedUrl ?? null;
          }
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          void markConversationReadAction(conversationId);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
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
          return (
            <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-1", mine ? "self-end items-end" : "self-start items-start")}>
              {!mine ? <span className="text-xs text-muted">{m.sender_id ? (names[m.sender_id] ?? t("member")) : t("deletedUser")}</span> : null}
              {m.image_url && !m.deleted_at ? (
                <a href={m.image_url} target="_blank" rel="noopener noreferrer" aria-label={t("openImage")} className="block overflow-hidden rounded-2xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, signed, short-lived link */}
                  <img src={m.image_url} alt={t("imageAlt")} loading="lazy" className="max-h-72 w-auto max-w-full object-contain" />
                </a>
              ) : null}
              {m.deleted_at || m.body ? (
                <div className={cn("whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink", m.deleted_at && "italic opacity-60")} dir="auto">
                  {m.deleted_at ? t("deleted") : m.body}
                </div>
              ) : null}
              <div className="flex items-center gap-1">
                <time className="text-[11px] text-faint" dateTime={m.created_at}>{fmt.format(new Date(m.created_at))}</time>
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

/** Text and/or one picture. The picture is previewed, and can be removed before sending. */
function Composer({ conversationId }: { conversationId: string }) {
  const t = useTranslations("messages");
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const clear = () => {
    if (fileInput.current) fileInput.current.value = "";
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  return (
    <ActionForm action={sendMessageAction} resetOnSuccess hideSuccess onSuccess={clear} className="gap-2">
      <Hidden values={{ conversation_id: conversationId }} />
      {preview ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
          <img src={preview} alt="" className="max-h-40 rounded-xl border border-line" />
          <button type="button" onClick={clear} aria-label={t("removeImage")} className="absolute -top-2 -end-2 flex size-7 items-center justify-center rounded-full bg-surface-3 text-ink shadow">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
      <label htmlFor="message-body" className="sr-only">{t("write")}</label>
      <Textarea id="message-body" name="body" required={!preview} maxLength={2000} placeholder={t("placeholder")} className="min-h-20" dir="auto" />
      <div className="flex items-center justify-between gap-2">
        <label className="flex size-11 cursor-pointer items-center justify-center rounded-xl border border-line text-muted transition-colors hover:text-ink" title={t("attach")}>
          <ImagePlus aria-hidden="true" className="size-5" />
          <span className="sr-only">{t("attach")}</span>
          <input
            ref={fileInput}
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="sr-only"
            onChange={async (e) => {
              const input = e.currentTarget;
              const chosen = input.files?.[0];
              if (!chosen) return clear();
              const small = await shrink(chosen);
              if (small !== chosen) {
                const list = new DataTransfer();
                list.items.add(small);
                input.files = list.files;
              }
              setPreview((old) => {
                if (old) URL.revokeObjectURL(old);
                return URL.createObjectURL(small);
              });
            }}
          />
        </label>
        <SubmitButton>{t("send")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
