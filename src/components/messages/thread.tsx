"use client";

import { Fragment, useEffect, useOptimistic, useRef, useState, type ReactNode } from "react";
import { Check, CheckCheck, Clock3, Phone, PhoneIncoming, PhoneMissed } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ReportButton } from "@/components/report-button";
import { prefersReducedMotion } from "@/components/motion/scroll";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient, getRealtimeClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { thumbPathOf } from "@/lib/message-thumb";
import { formatDuration } from "@/lib/duration";
import { editMessage, markConversationReadAction } from "@/server/messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { MediaViewer, type ViewedMedia } from "@/components/ui/media-viewer";
import { Composer } from "./composer";
import { LocationCard } from "./location-card";
import { MessageMenu } from "./message-menu";
import { VoiceNote } from "./voice-note";

export interface ThreadMessage {
  id: number;
  sender_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  edited_at?: string | null;
  image_path?: string | null;
  /** Short-lived signed link to the picture, when there is one. */
  image_url?: string | null;
  /** The picture's small copy, shown in the conversation (none for pictures sent before small copies existed). */
  image_thumb_url?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_accuracy?: number | null;
  voice_path?: string | null;
  voice_seconds?: number | null;
  /** Short-lived signed link to the voice note, when there is one. */
  voice_url?: string | null;
  call_outcome?: string | null;
  call_seconds?: number | null;
  /** Client only: how it entered while the conversation was open (an animation), absent for history. */
  anim?: "in" | "out";
}

/**
 * How a message enters while the conversation is open: mine rises out of the
 * box, theirs comes in. A text of mine already rose as it left (its "on its
 * way" copy), so its sent copy just takes its place; history doesn't move.
 */
const entering = (m: ThreadMessage, me: string): ThreadMessage["anim"] => {
  if (m.call_outcome) return undefined;
  if (m.sender_id !== me) return "in";
  const plainText = Boolean(m.body) && !m.image_path && !m.voice_path && m.location_lat == null;
  return plainText ? undefined : "out";
};

/** ✓ sent, ✓✓ in blue once seen (as on WhatsApp), a clock while on its way; the word itself only for screen readers. */
function Ticks({ status, label }: { status: "pending" | "sent" | "seen"; label: string }) {
  const Icon = status === "pending" ? Clock3 : status === "seen" ? CheckCheck : Check;
  return (
    <span data-testid="message-status" data-status={status} className="tick inline-flex items-center">
      <Icon aria-hidden="true" className={status === "pending" ? "size-3.5" : "size-4"} strokeWidth={status === "pending" ? 2 : 2.5} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * A text message on its way: in the conversation at once, until its sent copy
 * arrives. If sending fails it is simply gone again (the text goes back to
 * the box). `after` is the newest message there was when it left.
 */
interface PendingMessage {
  key: number;
  body: string;
  after: number;
}

/** When a message last changed: sent, edited or deleted. */
/** «حفظ»'s file name: the site's name and the message, with the file's own type. */
const savedName = (id: number, path: string | null | undefined) => `almalab-${id}.${path?.split(".").pop() ?? "jpg"}`;

const changedAt = (m: ThreadMessage) => Math.max(Date.parse(m.created_at), Date.parse(m.edited_at ?? "") || 0, Date.parse(m.deleted_at ?? "") || 0);

/** A deleted message keeps nothing of what it carried. */
const erased = (m: ThreadMessage, at: string): ThreadMessage => ({
  ...m,
  deleted_at: at,
  body: "",
  image_path: null,
  image_url: null,
  image_thumb_url: null,
  location_lat: null,
  location_lng: null,
  voice_path: null,
  voice_url: null,
});

/** How long «يكتب…» stays after the last keystroke heard, and how often typing is told. */
const TYPING_SHOWN_MS = 4000;
const TYPING_SEND_EVERY_MS = 2500;

/**
 * Message thread. Initial history is server-rendered; new messages, edits and
 * deletions arrive via Supabase Realtime (postgres_changes on `messages`,
 * filtered by RLS so only members receive them). Without realtime, the page
 * still works by reloading. The sender can edit or delete their messages.
 *
 * It fills its screen (messages/chat-screen.tsx): the list scrolls, the box to
 * write in stays at the bottom. Messages are grouped by day under «اليوم»,
 * «أمس» or the date, each with its time. Bubbles carry a tail on the last of
 * a run from one person, on the outer side. Names only in group chats, on the
 * first message of a run (a one-to-one conversation's bar already says who).
 * Every message of mine carries ticks, as on WhatsApp: ✓ sent, and in a
 * one-to-one conversation ✓✓ in blue once the other person has read it
 * (`seenAt`, and live from conversation_reads, migration 0033); a clock while
 * on its way. While someone types, three dots (a private broadcast channel per
 * conversation, members only, nothing stored). Each of these extra channels
 * is on its own, so without 0033 the messages still arrive live, with ✓ and
 * no dots. New messages rise into place (mine from the box, theirs from their
 * side); history doesn't move.
 */
export function Thread({
  conversationId,
  me,
  names,
  initial,
  locked,
  timeZone,
  direct = false,
  seenAt = null,
  top,
}: {
  conversationId: string;
  me: string;
  names: Record<string, string>;
  initial: ThreadMessage[];
  locked: boolean;
  timeZone: string;
  /** A conversation between two people: the only kind that says «شوهدت». */
  direct?: boolean;
  /** When the other person last read it (direct conversations). */
  seenAt?: string | null;
  /** At the top of the list, above the oldest message (older messages, the safety note). */
  top?: ReactNode;
}) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const errors = useTranslations("errors");
  const [messages, setMessages] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  // The message being edited, its new text, and how saving went.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // A picture opened over the conversation (not in a new tab), with «حفظ».
  const [viewing, setViewing] = useState<ViewedMedia | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  // Whether the newest message is in view: then new ones (and a smaller screen, the keyboard) keep it so.
  const atBottom = useRef(true);
  // When the conversation was opened: what «اليوم» and «أمس» mean.
  const [openedAt] = useState(() => Date.now());
  const pendingKey = useRef(0);
  // Held only while sending is under way, then dropped: by then the sent copy is in `messages`.
  const [pending, addPending] = useOptimistic<PendingMessage[], PendingMessage>([], (queue, p) => [...queue, p]);
  // When the other person last read the conversation (direct conversations): live, or newer from a server render.
  const [seen, setSeen] = useState<string | null>(seenAt);
  const [prevSeenAt, setPrevSeenAt] = useState(seenAt);
  if (seenAt !== prevSeenAt) {
    setPrevSeenAt(seenAt);
    if (seenAt && (!seen || Date.parse(seenAt) > Date.parse(seen))) setSeen(seenAt);
  }
  // Who is typing now, until when.
  const [typing, setTyping] = useState<Record<string, number>>({});
  const typingChannel = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);
  // A message that arrived while the page was hidden is read when the page is seen again.
  const unseenArrival = useRef(false);

  // Server re-render (e.g. after sending) brings fresh history: merge by id
  // so realtime-delivered messages aren't lost, keeping whichever copy of a
  // message changed last (derived-state pattern).
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of initial) {
        const have = byId.get(m.id);
        if (!have) byId.set(m.id, { ...m, anim: entering(m, me) });
        else if (changedAt(m) > changedAt(have)) byId.set(m.id, { ...m, anim: have.anim });
      }
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  }

  useEffect(() => {
    // Read means seen: a message that arrives while the page is in the background counts once the page is back.
    const markRead = () => {
      if (document.visibilityState === "visible") void markConversationReadAction(conversationId);
      else unseenArrival.current = true;
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && unseenArrival.current) {
        unseenArrival.current = false;
        void markConversationReadAction(conversationId);
      }
    };
    markRead();
    document.addEventListener("visibilitychange", onVisible);
    let channel: RealtimeChannel | null = null;
    let reads: RealtimeChannel | null = null;
    let typers: RealtimeChannel | null = null;
    let closed = false;
    // Joined as the member (RLS decides what reaches them), once the session has loaded.
    void getRealtimeClient().then((supabase) => {
      if (closed) return;
      // «شوهدت»: the other person's read time, as it changes (their row only reaches members of a direct conversation).
      if (direct) {
        reads = supabase
          .channel(`conversation-reads:${conversationId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "conversation_reads", filter: `conversation_id=eq.${conversationId}` },
            (payload) => {
              const row = payload.new as { user_id?: string; last_read_at?: string };
              if (!row.user_id || row.user_id === me || !row.last_read_at) return;
              const at = row.last_read_at;
              setSeen((prev) => (!prev || Date.parse(at) > Date.parse(prev) ? at : prev));
            },
          )
          .subscribe();
      }
      // «يكتب…»: a private channel only the conversation's members may join; refused, it is simply left.
      typers = supabase
        .channel(`typing:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          const who = (payload as { user?: unknown })?.user;
          if (typeof who !== "string" || who === me) return;
          setTyping((prev) => ({ ...prev, [who]: Date.now() + TYPING_SHOWN_MS }));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") typingChannel.current = typers;
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            typingChannel.current = null;
            if (typers) void supabase.removeChannel(typers);
            typers = null;
          }
        });
      channel = supabase
        .channel(`conversation:${conversationId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          async (payload) => {
            const msg = payload.new as ThreadMessage;
            // Live messages carry the files' paths only; sign them with the member's session.
            if (msg.image_path && !msg.image_url) {
              const thumb = thumbPathOf(msg.image_path);
              const { data } = await supabase.storage.from("message-images").createSignedUrls([msg.image_path, thumb], 3600);
              msg.image_url = data?.find((s) => s.path === msg.image_path)?.signedUrl ?? null;
              msg.image_thumb_url = data?.find((s) => s.path === thumb)?.signedUrl ?? null;
            }
            if (msg.voice_path && !msg.voice_url) {
              const { data } = await supabase.storage.from("message-voice").createSignedUrl(msg.voice_path, 3600);
              msg.voice_url = data?.signedUrl ?? null;
            }
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, { ...msg, anim: entering(msg, me) }]));
            // Their message is here: they're no longer typing it.
            if (msg.sender_id) {
              const sender = msg.sender_id;
              setTyping((prev) => {
                if (!(sender in prev)) return prev;
                const rest = { ...prev };
                delete rest[sender];
                return rest;
              });
            }
            markRead();
          },
        )
        // An edit or a deletion: the new text, or «رسالة محذوفة».
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const msg = payload.new as ThreadMessage;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== msg.id) return m;
                if (msg.deleted_at) return erased(m, msg.deleted_at);
                return { ...m, body: msg.body, edited_at: msg.edited_at ?? m.edited_at };
              }),
            );
          },
        )
        .subscribe();
    });
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      typingChannel.current = null;
      for (const c of [channel, reads, typers]) if (c) void getBrowserClient().removeChannel(c);
    };
  }, [conversationId, direct, me]);

  // «يكتب…» fades once nobody has been heard typing for a few seconds.
  const typingUntil = Object.values(typing).reduce((max, at) => Math.max(max, at), 0);
  useEffect(() => {
    if (!typingUntil) return;
    const id = window.setTimeout(() => {
      const now = Date.now();
      setTyping((prev) => Object.fromEntries(Object.entries(prev).filter(([, until]) => until > now)));
    }, Math.max(0, typingUntil - Date.now()) + 50);
    return () => window.clearTimeout(id);
  }, [typingUntil]);

  /** Tells the others I'm typing: at most every few seconds, only on the joined members' channel. */
  const onTyping = () => {
    const now = Date.now();
    if (!typingChannel.current || now - lastTypingSent.current < TYPING_SEND_EVERY_MS) return;
    lastTypingSent.current = now;
    void typingChannel.current.send({ type: "broadcast", event: "typing", payload: { user: me } });
  };

  // A message on its way gives way to its sent copy, which can arrive (live)
  // before sending has finished: the next of mine with the same text, newer
  // than anything there was when it left. Each copy stands for one message.
  const taken = new Set<number>();
  const waiting = pending.filter((p) => {
    const copy = messages.find((m) => !taken.has(m.id) && m.sender_id === me && m.id > p.after && m.body === p.body);
    if (copy) taken.add(copy.id);
    return !copy;
  });
  const typers = Object.keys(typing).filter((u) => u !== me);
  const shown = messages.length + waiting.length + (typers.length ? 1 : 0);
  const isCall = (m: ThreadMessage | undefined) => Boolean(m?.call_outcome && !m.deleted_at);
  // Days, in the conversation's time zone: «اليوم», «أمس», or the date.
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const today = dayOf(new Date(openedAt).toISOString());
  const yesterday = dayOf(new Date(openedAt - 86_400_000).toISOString());
  const dayLabel = (iso: string) => {
    const day = dayOf(iso);
    if (day === today) return t("today");
    if (day === yesterday) return t("yesterday");
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
  };
  // A run: messages in a row from one person on one day (a call line ends it).
  const sameRun = (a: ThreadMessage | undefined, b: ThreadMessage | undefined) =>
    Boolean(a && b) && a!.sender_id === b!.sender_id && !isCall(a) && !isCall(b) && dayOf(a!.created_at) === dayOf(b!.created_at);
  // The tail goes on the last bubble of a run (mine continue into those still on their way).
  const endsRun = (i: number) => {
    const m = messages[i];
    const next = messages[i + 1];
    if (!next) return !(m.sender_id === me && waiting.length > 0);
    return !sameRun(m, next);
  };
  const seenBy = (m: ThreadMessage) => direct && seen !== null && Date.parse(seen) >= Date.parse(m.created_at);
  const newestIsMine = waiting.length > 0 || messages.at(-1)?.sender_id === me;

  // The newest message is at the bottom: open there, then glide down to each new one if the newest
  // was in view (or it is mine). Only the list scrolls, so the box to write in stays where it is.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!opened.current || atBottom.current || newestIsMine) {
      el.scrollTo({ top: el.scrollHeight, behavior: opened.current && !prefersReducedMotion() ? "smooth" : "auto" });
      atBottom.current = true;
    }
    opened.current = true;
  }, [shown, newestIsMine]);

  // The screen gets smaller when the keyboard opens: the newest message stays in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", { timeZone, hour: "numeric", minute: "2-digit" });
  const bubbleWidth = "max-w-[85%] sm:max-w-[70%]";

  const startEdit = (m: ThreadMessage) => {
    setEditing(m.id);
    setDraft(m.body);
    setEditError(null);
  };
  const saveEdit = async (m: ThreadMessage) => {
    const text = draft.trim();
    if (text === m.body) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setEditError(null);
    const res = await editMessage(m.id, text);
    setSaving(false);
    if (!res.ok) {
      setEditError(errors.has(res.error) ? errors(res.error) : errors("generic"));
      return;
    }
    const at = new Date().toISOString();
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, body: text, edited_at: at } : x)));
    setEditing(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col px-3 pb-3 pt-4 sm:px-6">
          {top}
          <ol className="flex flex-col gap-1" aria-live="polite" aria-label={t("history")}>
            {shown === 0 ? <li className="m-auto py-10 text-sm text-muted">{t("noMessages")}</li> : null}
            {messages.map((m, i) => {
              const mine = m.sender_id === me;
              const prev = messages[i - 1];
              const newDay = !prev || dayOf(prev.created_at) !== dayOf(m.created_at);
              const startsRun = newDay || !sameRun(prev, m);
              const time = (
                <time className="text-[11px] text-faint" dateTime={m.created_at}>
                  {fmt.format(new Date(m.created_at))}
                </time>
              );
              const day = newDay ? (
                <li className="day-sep my-2 self-center" data-testid="day">
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted" suppressHydrationWarning>
                    {dayLabel(m.created_at)}
                  </span>
                </li>
              ) : null;
              // A call's record sits in the middle: it belongs to both.
              if (isCall(m)) {
                const answered = m.call_outcome === "answered";
                const Icon = answered ? (mine ? Phone : PhoneIncoming) : PhoneMissed;
                return (
                  <Fragment key={m.id}>
                    {day}
                    <li className="my-2 flex flex-col items-center gap-1 self-center" data-testid="call-line">
                      <span className={cn("flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold", !answered && !mine ? "text-danger" : "text-muted")}>
                        <Icon aria-hidden="true" className="size-3.5" />
                        {answered ? t("callAnswered", { duration: formatDuration(m.call_seconds ?? 0, locale) }) : mine ? t("callNoAnswer") : t("callMissed")}
                      </span>
                      {time}
                    </li>
                  </Fragment>
                );
              }
              const hasLocation = m.location_lat != null && m.location_lng != null && !m.deleted_at;
              const status = seenBy(m) ? "seen" : "sent";
              return (
                <Fragment key={m.id}>
                  {day}
                  {/* Your own (green) messages on the right, the others' on the left. The page is right-to-left,
                      so "start" is the right-hand side. */}
                  <li
                    className={cn("flex flex-col gap-1", bubbleWidth, mine ? "self-start items-start" : "self-end items-end", startsRun && !newDay && "mt-2", m.anim && `msg-anim-${m.anim}`)}
                    data-mine={mine || undefined}
                  >
                    {/* Group chats: who wrote, on the first of their run (it opens their page). One-to-one: the bar says who. */}
                    {!mine && !direct && startsRun ? (
                      m.sender_id ? (
                        <Link href={`/players/${m.sender_id}`} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                          {names[m.sender_id] ?? t("member")}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">{t("deletedUser")}</span>
                      )
                    ) : null}
                    {m.image_url && !m.deleted_at ? (
                      <button
                        type="button"
                        onClick={() => setViewing({ kind: "image", src: m.image_url!, alt: t("imageAlt"), saveAs: savedName(m.id, m.image_path) })}
                        aria-label={t("openImage")}
                        className="block overflow-hidden rounded-2xl border border-line"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- private, signed, short-lived link */}
                        <img src={m.image_thumb_url ?? m.image_url} alt={t("imageAlt")} loading="lazy" className="max-h-72 w-auto max-w-full object-contain" />
                      </button>
                    ) : null}
                    {hasLocation ? <LocationCard lat={m.location_lat!} lng={m.location_lng!} accuracy={m.location_accuracy ?? null} /> : null}
                    {m.voice_path && !m.deleted_at ? <VoiceNote src={m.voice_url ?? null} seconds={m.voice_seconds ?? 1} mine={mine} /> : null}
                    {editing === m.id ? (
                      <form
                        className="flex w-72 max-w-full flex-col gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveEdit(m);
                        }}
                      >
                        <Textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditing(null);
                          }}
                          maxLength={2000}
                          required
                          autoFocus
                          aria-label={t("editLabel")}
                          dir="auto"
                          className="min-h-20 text-base"
                        />
                        {editError ? <p role="alert" className="text-xs text-danger">{editError}</p> : null}
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t("cancel")}</Button>
                          <Button type="submit" size="sm" disabled={saving || !draft.trim()}>{t("save")}</Button>
                        </div>
                      </form>
                    ) : m.deleted_at || m.body ? (
                      // The bubble keeps the page's direction, so its tail stays on the outer side; the text finds its own.
                      <div
                        className={cn(
                          "bubble rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed",
                          mine ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink",
                          m.deleted_at ? "italic opacity-60" : endsRun(i) && "bubble-tail",
                        )}
                        data-side={mine ? "start" : "end"}
                      >
                        <span className="block whitespace-pre-wrap break-words" dir="auto">
                          {m.deleted_at ? t("deleted") : m.body}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1">
                      {time}
                      {mine && !m.deleted_at ? <Ticks status={status} label={status === "seen" ? t("seen") : t("sent")} /> : null}
                      {m.edited_at && !m.deleted_at ? <span className="text-[11px] text-faint">· {t("edited")}</span> : null}
                      {!mine && !m.deleted_at ? <ReportButton targetType="message" targetId={String(m.id)} compact /> : null}
                      {mine && !m.deleted_at && editing !== m.id ? (
                        <MessageMenu
                          messageId={m.id}
                          canEdit={Boolean(m.body)}
                          onEdit={() => startEdit(m)}
                          onDeleted={() => setMessages((prev) => prev.map((x) => (x.id === m.id ? erased(x, new Date().toISOString()) : x)))}
                        />
                      ) : null}
                    </div>
                  </li>
                </Fragment>
              );
            })}
            {/* On its way: it rises out of the box at once. Hidden from screen readers: they hear the message
                once, when it has been sent (the list is live). */}
            {waiting.map((p, i) => (
              <li
                key={`pending-${p.key}`}
                className={cn("msg-anim-out flex flex-col items-start gap-1 self-start", bubbleWidth, i === 0 && messages.at(-1)?.sender_id !== me && "mt-2")}
                data-pending=""
                aria-hidden="true"
              >
                <div className={cn("bubble rounded-2xl bg-accent px-3.5 py-2 text-[15px] leading-relaxed text-accent-ink opacity-80", i === waiting.length - 1 && "bubble-tail")} data-side="start">
                  <span className="block whitespace-pre-wrap break-words" dir="auto">
                    {p.body}
                  </span>
                </div>
                <Ticks status="pending" label={t("sending")} />
              </li>
            ))}
            {/* Someone is typing: three dots in their bubble (said once to screen readers, below). */}
            {typers.length ? (
              <li className={cn("msg-anim-in mt-2 flex flex-col items-end gap-1 self-end", bubbleWidth)} aria-hidden="true" data-testid="typing">
                {!direct ? <span className="text-xs text-muted">{typers.map((u) => names[u] ?? t("member")).join("، ")}</span> : null}
                <div className="bubble bubble-tail flex h-9 items-center gap-1 rounded-2xl bg-surface-3 px-4" data-side="end">
                  <span className="typing-dot size-1.5 rounded-full bg-muted" />
                  <span className="typing-dot size-1.5 rounded-full bg-muted" />
                  <span className="typing-dot size-1.5 rounded-full bg-muted" />
                </div>
              </li>
            ) : null}
          </ol>
        </div>
      </div>
      <p role="status" className="sr-only">
        {typers.length ? (direct ? t("typing") : t("typingNamed", { names: typers.map((u) => names[u] ?? t("member")).join("، ") })) : ""}
      </p>
      {/* At the bottom of the screen, above the keyboard when it is open (messages/chat-screen.tsx). */}
      <div className="chat-composer border-t border-line bg-bg/95 px-3 pt-2 backdrop-blur sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {locked ? (
            <p className="py-2 text-center text-sm text-muted">{t("lockedNote")}</p>
          ) : (
            <Composer
              conversationId={conversationId}
              onTyping={onTyping}
              onSending={(body) => addPending({ key: ++pendingKey.current, body, after: messages.reduce((max, m) => Math.max(max, m.id), 0) })}
            />
          )}
        </div>
      </div>
      <MediaViewer media={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
