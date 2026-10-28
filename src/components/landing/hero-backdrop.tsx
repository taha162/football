"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play } from "lucide-react";
import type { HeroMedia } from "@/lib/hero-media";

interface HeroVideoState {
  video: RefObject<HTMLVideoElement | null>;
  active: boolean;
  playing: boolean;
  /** True once the footage has rendered a frame; it then stays visible even when paused. */
  started: boolean;
  setPlaying: (v: boolean) => void;
  setFailed: (v: boolean) => void;
}

const HeroVideoContext = createContext<HeroVideoState | null>(null);

/** Shares playback state between the backdrop and its control (which lives in the hero's caption strip). */
export function HeroVideoProvider({ media, children }: { media: HeroMedia; children: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = Boolean(media.mp4 || media.webm || media.mobileMp4) && !failed;
  const onPlaying = (v: boolean) => {
    setPlaying(v);
    if (v) setStarted(true);
  };
  return (
    <HeroVideoContext.Provider value={{ video, active, playing, started, setPlaying: onPlaying, setFailed }}>{children}</HeroVideoContext.Provider>
  );
}

/**
 * Full-bleed hero media: the poster is always painted first (no layout shift,
 * good first frame); the video fades in once it actually plays. Autoplay is
 * skipped for reduced-motion and Save-Data visitors, and any playback error
 * simply leaves the poster in place.
 */
export function HeroBackdrop({ media }: { media: HeroMedia }) {
  const ctx = useContext(HeroVideoContext)!;
  const { video, active, started, setPlaying, setFailed } = ctx;

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    // <video> does not fire "error" when its <source>s fail; the last source does.
    // It may already have failed before hydration (the HTML starts loading it).
    if (el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      setFailed(true);
      return;
    }
    const last = el.querySelector("source:last-of-type");
    const onSourceError = () => setFailed(true);
    last?.addEventListener("error", onSourceError);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!reduced && !saveData) {
      el.play().catch((e: unknown) => {
        // Autoplay refusal (NotAllowedError) keeps the control; unplayable media hides it.
        if (e instanceof DOMException && e.name === "NotSupportedError") setFailed(true);
      });
    }
    return () => last?.removeEventListener("error", onSourceError);
  }, [video, setFailed]);

  return (
    <div className="hero-media absolute inset-0">
      <picture>
        {media.mobilePoster ? <source media="(max-width: 767px) and (orientation: portrait)" srcSet={media.mobilePoster} /> : null}
        {/* Plain <img>: the poster is the LCP frame, may be an SVG or remote file, and must not be lazy. */}
        <img
          src={media.poster}
          alt=""
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: media.focus }}
        />
      </picture>
      {active ? (
        <video
          ref={video}
          className="absolute inset-0 size-full object-cover transition-opacity duration-[1200ms] ease-out"
          style={{ objectPosition: media.focus, opacity: started ? 1 : 0 }}
          muted
          loop
          playsInline
          preload="metadata"
          poster={media.poster}
          disablePictureInPicture
          aria-hidden="true"
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
        >
          {media.mobileMp4 ? <source src={media.mobileMp4} type="video/mp4" media="(max-width: 767px) and (orientation: portrait)" /> : null}
          {media.webm ? <source src={media.webm} type="video/webm" /> : null}
          {media.mp4 ? <source src={media.mp4} type="video/mp4" /> : null}
        </video>
      ) : null}
    </div>
  );
}

/** Pause/play for the background footage (WCAG 2.2.2); rendered only when a video is configured. */
export function HeroVideoControl() {
  const t = useTranslations("home.hero");
  const ctx = useContext(HeroVideoContext);
  if (!ctx?.active) return null;
  const { video, playing, setFailed } = ctx;
  return (
    <button
      type="button"
      onClick={() => {
        const el = video.current;
        if (!el) return;
        if (el.paused) el.play().catch(() => setFailed(true));
        else el.pause();
      }}
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/30 text-ink/90 backdrop-blur-sm transition-colors hover:border-accent hover:text-accent"
      aria-label={playing ? t("pauseVideo") : t("playVideo")}
    >
      {playing ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
    </button>
  );
}
