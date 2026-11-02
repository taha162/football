"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mic, MicOff, Phone, PhoneOff, Volume2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/duration";
import type { CallView } from "./call-provider";

/** Seconds since the call connected, ticking once a second. */
function useElapsed(connectedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);
  return connectedAt ? Math.max(0, Math.round((now - connectedAt) / 1000)) : 0;
}

/**
 * The call, full screen: who, what's happening, and the two buttons that
 * matter (answer/decline, or mute/hang up). It can shrink to a bar at the top
 * while the person keeps using the site.
 */
export function CallScreen({
  view,
  onAccept,
  onDecline,
  onHangUp,
  onMute,
  onSpeaker,
  onMinimize,
  onDismiss,
}: {
  view: CallView;
  onAccept: () => void;
  onDecline: () => void;
  onHangUp: () => void;
  onMute: () => void;
  onSpeaker: () => void;
  onMinimize: (minimized: boolean) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("calls");
  const locale = useLocale();
  const elapsed = useElapsed(view.phase === "active" ? view.connectedAt : null);
  const primary = useRef<HTMLButtonElement>(null);
  const open = view.phase !== "idle";
  const expanded = open && !view.minimized;

  // The main action takes focus when the screen opens or changes.
  useEffect(() => {
    if (expanded) primary.current?.focus({ preventScroll: true });
  }, [expanded, view.phase]);

  if (!open) return null;

  const name = view.peer?.name || t("someone");
  const status =
    view.phase === "incoming"
      ? t("incoming")
      : view.phase === "outgoing"
        ? view.ringing
          ? t("ringing")
          : t("calling")
        : view.phase === "connecting"
          ? t("connecting")
          : view.phase === "active"
            ? view.reconnecting
              ? t("reconnecting")
              : formatDuration(elapsed, locale)
            : view.note === "ended" && view.durationAtEnd !== null
              ? `${t("note.ended")} · ${formatDuration(view.durationAtEnd, locale)}`
              : t(`note.${view.note ?? "ended"}`);

  if (view.minimized) {
    return (
      <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface-3/95 px-3 py-2 shadow-xl backdrop-blur" role="region" aria-label={t("inCall")}>
        <Avatar src={view.peer?.avatarUrl} name={name} size={36} />
        <button type="button" onClick={() => onMinimize(false)} className="flex min-w-0 flex-1 flex-col text-start" aria-label={t("expand")}>
          <span className="truncate text-sm font-semibold text-ink">{name}</span>
          <span className="num truncate text-xs text-accent">{status}</span>
        </button>
        <button type="button" onClick={onHangUp} aria-label={t("hangUp")} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger text-white">
          <PhoneOff aria-hidden="true" className="size-5" />
        </button>
      </div>
    );
  }

  const round = "flex size-16 items-center justify-center rounded-full transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4";
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="call-name" aria-describedby="call-status" className="call-screen fixed inset-0 z-[60] flex flex-col items-center justify-between px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
      <div className="flex w-full max-w-md justify-start">
        {["outgoing", "connecting", "active"].includes(view.phase) ? (
          <button type="button" onClick={() => onMinimize(true)} aria-label={t("minimize")} className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
            <ChevronDown aria-hidden="true" className="size-6" />
          </button>
        ) : view.phase === "ended" ? (
          <button type="button" onClick={onDismiss} aria-label={t("close")} className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
            <X aria-hidden="true" className="size-6" />
          </button>
        ) : (
          <span className="size-11" />
        )}
      </div>

      <div className="flex flex-col items-center gap-5 text-center">
        <span className={cn("rounded-full", (view.phase === "incoming" || (view.phase === "outgoing" && view.ringing)) && "call-ringing")}>
          <Avatar src={view.peer?.avatarUrl} name={name} size={112} className="ring-4 ring-accent/25" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 id="call-name" className="font-display text-3xl font-extrabold text-ink">{name}</h2>
          <p
            id="call-status"
            role="status"
            aria-live="polite"
            className={cn(
              "num",
              view.phase === "ended" ? "text-base text-muted" : "text-accent",
              view.phase === "active" && !view.reconnecting ? "font-display text-2xl font-bold tracking-wider" : "text-base",
            )}
          >
            {status}
          </p>
        </div>
        {view.phase === "outgoing" && view.ringing ? <p className="max-w-xs text-xs text-faint">{t("ringsWhereOpen")}</p> : null}
      </div>

      <div className="flex w-full max-w-sm items-start justify-around gap-4">
        {view.phase === "incoming" ? (
          <>
            <span className="flex flex-col items-center gap-2 text-sm text-muted">
              <button type="button" onClick={onDecline} aria-label={t("decline")} className={cn(round, "bg-danger text-white focus-visible:outline-danger")}>
                <PhoneOff aria-hidden="true" className="size-7" />
              </button>
              {t("decline")}
            </span>
            <span className="flex flex-col items-center gap-2 text-sm text-muted">
              <button ref={primary} type="button" onClick={onAccept} aria-label={t("accept")} className={cn(round, "bg-accent text-accent-ink focus-visible:outline-accent")}>
                <Phone aria-hidden="true" className="size-7" />
              </button>
              {t("accept")}
            </span>
          </>
        ) : view.phase === "ended" ? null : (
          <>
            <span className="flex flex-col items-center gap-2 text-sm text-muted">
              <button
                type="button"
                onClick={onMute}
                aria-pressed={view.muted}
                aria-label={view.muted ? t("unmute") : t("mute")}
                disabled={view.phase === "outgoing" && !view.ringing}
                className={cn(round, "focus-visible:outline-accent disabled:opacity-40", view.muted ? "bg-ink text-bg" : "bg-surface-3 text-ink")}
              >
                {view.muted ? <MicOff aria-hidden="true" className="size-7" /> : <Mic aria-hidden="true" className="size-7" />}
              </button>
              {view.muted ? t("unmute") : t("mute")}
            </span>
            {/* Only where the phone lets the page choose (see audio-route.ts). */}
            {view.speakerAvailable ? (
              <span className="flex flex-col items-center gap-2 text-sm text-muted">
                <button
                  type="button"
                  onClick={onSpeaker}
                  aria-pressed={view.speaker}
                  aria-label={t("speaker")}
                  className={cn(round, "focus-visible:outline-accent", view.speaker ? "bg-ink text-bg" : "bg-surface-3 text-ink")}
                >
                  <Volume2 aria-hidden="true" className="size-7" />
                </button>
                {t("speaker")}
              </span>
            ) : null}
            <span className="flex flex-col items-center gap-2 text-sm text-muted">
              <button ref={primary} type="button" onClick={onHangUp} aria-label={t("hangUp")} className={cn(round, "bg-danger text-white focus-visible:outline-danger")}>
                <PhoneOff aria-hidden="true" className="size-7" />
              </button>
              {t("hangUp")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
