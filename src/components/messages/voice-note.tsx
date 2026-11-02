"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/duration";

/**
 * Plays a voice note. The length comes from the message (recordings made in
 * Chrome carry no length of their own until fully loaded). Loads nothing until
 * played, to spare mobile data.
 */
export function VoiceNote({ src, seconds, mine }: { src: string | null; seconds: number; mine: boolean }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const total = Math.max(1, seconds);

  // Only one voice note plays at a time.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const others = () => {
      if (!el.paused) el.pause();
    };
    const onPlay = (e: Event) => {
      if (e.target !== el) others();
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  return (
    <div className={cn("flex w-64 max-w-full items-center gap-3 rounded-2xl px-3 py-2", mine ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink")} data-testid="voice-note">
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? t("pause") : t("play")}
        className={cn("flex size-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-50", mine ? "bg-accent-ink/15" : "bg-accent text-accent-ink")}
      >
        {/* Media controls keep their direction in Arabic too. */}
        {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={total}
          step={0.1}
          value={Math.min(current, total)}
          aria-label={t("voiceProgress")}
          onChange={(e) => {
            const value = Number(e.currentTarget.value);
            setCurrent(value);
            if (audio.current && Number.isFinite(value)) audio.current.currentTime = value;
          }}
          className={cn("h-1.5 w-full cursor-pointer", mine ? "accent-accent-ink" : "accent-accent")}
        />
        <span className="num text-[11px] opacity-80">{formatDuration(playing || current > 0 ? current : total, locale)}</span>
      </div>
      <audio
        ref={audio}
        src={src ?? undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />
    </div>
  );
}
