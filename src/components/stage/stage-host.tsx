"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import type { MarkerSpec, PositionKey, Stage } from "./engine";

export interface StageLabels {
  controls: string;
  skip: string;
  soundOn: string;
  soundOff: string;
  motionPause: string;
  motionPlay: string;
  resetBall: string;
  kick: string;
  kickHint: string;
}

type Mode = "loading" | "live" | "fallback";

/** Is WebGL 2 available, and which GPU will render? Uses a throwaway context. */
function probeWebGL(): { ok: boolean; gpu?: string } {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return { ok: false };
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true, gpu };
  } catch {
    return { ok: false };
  }
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeReducedMotion = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

function setRootAttr(name: string, value: string | null) {
  if (value === null) document.documentElement.removeAttribute(name);
  else document.documentElement.setAttribute(name, value);
}

/**
 * Clears the stage's marks on <html> once the landing page has really gone
 * (not between React's development-mode unmount and remount, which would
 * otherwise cancel the opening before it starts).
 */
let mountedHosts = 0;
function releaseRoot() {
  mountedHosts--;
  window.setTimeout(() => {
    if (mountedHosts > 0) return;
    setRootAttr("data-stage", null);
    setRootAttr("data-intro", null);
  }, 0);
}

/**
 * Hosts the WebGL stadium behind the landing page's scenes: probes for
 * WebGL, lazy-loads the engine, keeps it in step with scroll, pointer and
 * visibility, and falls back to a still image wherever WebGL is missing or
 * lost. The page content never waits for any of it.
 */
export function StageHost({ markers, labels, children }: { markers: MarkerSpec[]; labels: StageLabels; children: ReactNode }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const scenesRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const flick = useRef<{ x: number; y: number; t: number }[]>([]);
  const lastPointerKick = useRef(0);

  const [mode, setMode] = useState<Mode>("loading");
  const [intro, setIntro] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
  const [motionChoice, setMotionChoice] = useState<boolean | null>(null);
  const motion = motionChoice ?? !reducedMotion;
  const [sound, setSound] = useState(false);
  const [ballAway, setBallAway] = useState(false);
  const [kicked, setKicked] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    const rtl = html.dir === "rtl";
    const reduced = window.matchMedia(REDUCED_MOTION).matches;
    // The opening plays only when the pre-paint script asked for it (first visit this session).
    const wantsIntro = html.getAttribute("data-intro") === "wait";
    let disposed = false;
    let stage: Stage | null = null;
    const cleanups: (() => void)[] = [];

    const fallback = () => {
      setMode("fallback");
      setRootAttr("data-stage", "fallback");
      setRootAttr("data-intro", "done");
      setIntro(false);
    };

    const probe = probeWebGL();
    if (!probe.ok || !canvasRef.current) {
      fallback();
      mountedHosts++;
      return releaseRoot;
    }
    mountedHosts++;
    setRootAttr("data-stage", "loading");

    /* ---- scroll → scene coordinate -------------------------------------- */
    let tops: number[] = [];
    let heights: number[] = [];
    const measure = () => {
      const scenes = scenesRef.current?.querySelectorAll<HTMLElement>("[data-scene]") ?? [];
      tops = [];
      heights = [];
      scenes.forEach((el) => {
        const r = el.getBoundingClientRect();
        tops.push(r.top + window.scrollY);
        heights.push(Math.max(1, r.height));
      });
    };
    const sceneCoordinate = () => {
      const center = window.scrollY + window.innerHeight * 0.5;
      for (let i = 0; i < tops.length; i++) {
        if (center < tops[i] + heights[i] || i === tops.length - 1) {
          return i + Math.min(1, Math.max(0, (center - tops[i]) / heights[i]));
        }
      }
      return 0;
    };
    const onScroll = () => stage?.setScroll(sceneCoordinate());

    /* ---- any deliberate input ends the opening -------------------------- */
    // (The scene controls are exempt, so sound can be turned on to hear it.)
    const inControls = (el: EventTarget | Element | null) => el instanceof Element && el.closest(".stage-controls") !== null;
    const endIntro = (e?: Event) => {
      if (e && inControls(e.target)) return;
      if (stage?.introPlaying) stage.skipIntro();
      else if (html.getAttribute("data-intro") === "wait") setRootAttr("data-intro", "done");
    };
    const onKey = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if ((e.key === "Enter" || e.key === " ") && inControls(document.activeElement)) return;
      endIntro();
    };

    /* ---- the position list highlights its marker on the pitch ----------- */
    const positionOf = (e: Event) => (e.target instanceof Element ? (e.target.closest<HTMLElement>("[data-position]")?.dataset.position ?? null) : null);
    const onListOver = (e: Event) => stage?.highlightMarker(positionOf(e) as PositionKey | null);
    const scenesEl = scenesRef.current;
    scenesEl?.addEventListener("pointerover", onListOver);
    scenesEl?.addEventListener("focusin", onListOver);
    cleanups.push(() => {
      scenesEl?.removeEventListener("pointerover", onListOver);
      scenesEl?.removeEventListener("focusin", onListOver);
    });

    /* ---- pointer: parallax and the tactical markers --------------------- */
    const fine = window.matchMedia("(pointer: fine)").matches;
    const onPointerMove = (e: PointerEvent) => {
      if (!stage) return;
      if (fine && e.pointerType === "mouse") stage.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      const canvas = canvasRef.current;
      if (canvas && e.target === canvas) {
        const hit = stage.markerAt(e.clientX, e.clientY);
        stage.setHover(hit);
        canvas.style.cursor = hit ? "pointer" : "";
      }
    };
    const onCanvasClick = (e: MouseEvent) => {
      const hit = stage?.markerAt(e.clientX, e.clientY);
      if (hit) router.push(`/recruitment?position=${hit}`);
    };

    /* ---- engine ----------------------------------------------------------- */
    const fontsReady = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
    const cssVar = (name: string) => getComputedStyle(html).getPropertyValue(name).trim();
    Promise.all([import("./engine"), fontsReady])
      .then(async ([{ Stage }]) => {
        if (disposed || !canvasRef.current) return;
        const instance = new Stage({
          canvas: canvasRef.current,
          handle: handleRef.current,
          rtl,
          reducedMotion: reduced,
          gpu: probe.gpu,
          fonts: {
            arabic: cssVar("--font-cairo") || "system-ui, sans-serif",
            latin: cssVar("--font-barlow-condensed") || "system-ui, sans-serif",
          },
          markers,
          events: {
            onIntro: (phase) => {
              setRootAttr("data-intro", phase);
              setIntro(phase !== "done");
            },
            onBallAway: setBallAway,
            onKick: () => setKicked(true),
            onFirstFrame: () => {
              setMode("live");
              setRootAttr("data-stage", "live");
            },
            onContextLost: () => setRootAttr("data-stage", "lost"),
            onContextRestored: () => setRootAttr("data-stage", "live"),
            onError: () => {
              stage?.dispose();
              stage = null;
              stageRef.current = null;
              if (!disposed) fallback();
            },
          },
        });
        stage = instance;
        stageRef.current = instance;
        measure();
        instance.setScroll(sceneCoordinate());
        await instance.prepare();
        // Disposed meanwhile: unmounted, or a shader failed and the still image took over.
        if (disposed || stage !== instance) return;
        // The failsafe in the pre-paint script may already have released the page, and a
        // visit that starts further down (restored scroll) goes straight to its scene.
        instance.begin(wantsIntro && html.getAttribute("data-intro") === "wait" && sceneCoordinate() < 1);
      })
      .catch((err: unknown) => {
        console.error("Stage unavailable, showing the still image instead.", err);
        stage?.dispose();
        stage = null;
        stageRef.current = null;
        if (!disposed) fallback();
      });

    measure();
    const ro = new ResizeObserver(() => {
      measure();
      stage?.resize();
      onScroll();
    });
    if (scenesRef.current) ro.observe(scenesRef.current);
    if (canvasRef.current) ro.observe(canvasRef.current);
    cleanups.push(() => ro.disconnect());

    // Render only while the stage is on screen and the tab is visible.
    let onScreen = true;
    const sync = () => stage?.setActive(onScreen && !document.hidden);
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    if (root.current) io.observe(root.current);
    document.addEventListener("visibilitychange", sync);
    cleanups.push(() => io.disconnect(), () => document.removeEventListener("visibilitychange", sync));

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", endIntro, { passive: true });
    window.addEventListener("touchstart", endIntro, { passive: true });
    window.addEventListener("pointerdown", endIntro, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    const canvas = canvasRef.current;
    canvas.addEventListener("click", onCanvasClick);
    cleanups.push(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", endIntro);
      window.removeEventListener("touchstart", endIntro);
      window.removeEventListener("pointerdown", endIntro);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("click", onCanvasClick);
    });

    return () => {
      disposed = true;
      cleanups.forEach((f) => f());
      stage?.dispose();
      stageRef.current = null;
      releaseRoot();
    };
    // Mount once: markers and labels are fixed for the page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- the ball: flick it, or press Enter/Space ----------------------- */
  const onBallDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer may already be gone; the gesture still works without capture */
    }
    flick.current = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
  };
  const onBallMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!flick.current.length) return;
    // On a busy frame the browser merges moves; the merged ones keep their own timestamps.
    const moves = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const m of moves.length ? moves : [e.nativeEvent]) flick.current.push({ x: m.clientX, y: m.clientY, t: m.timeStamp });
    if (flick.current.length > 24) flick.current.splice(0, flick.current.length - 24);
  };
  const onBallUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const samples = flick.current;
    flick.current = [];
    if (!samples.length) return;
    samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    // Release velocity over the last ~100 ms of the gesture.
    const end = samples[samples.length - 1];
    const start = samples.find((s) => end.t - s.t <= 100) ?? samples[0];
    const dt = Math.max(16, end.t - start.t) / 1000;
    stageRef.current?.kickFromScreen((end.x - start.x) / dt, (end.y - start.y) / dt);
    lastPointerKick.current = e.timeStamp;
  };
  const onBallClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Pointer gestures already kicked on release; this is the keyboard path.
    if (e.timeStamp - lastPointerKick.current < 400) return;
    stageRef.current?.kickForward();
  };

  const toggleSound = async () => {
    const next = !sound;
    setSound(next);
    try {
      await stageRef.current?.setSound(next);
    } catch {
      setSound(false);
    }
  };
  const toggleMotion = () => {
    const next = !motion;
    setMotionChoice(next);
    stageRef.current?.setMotion(next);
  };

  return (
    <div ref={root} className="stage-root" data-mode={mode}>
      {/* Scene controls come first so they are early in the tab order. */}
      <div className="stage-controls" role="group" aria-label={labels.controls}>
        {intro ? (
          <button type="button" className="stage-control stage-control-text" onClick={() => stageRef.current?.skipIntro()}>
            {labels.skip}
            <SkipForward aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          </button>
        ) : null}
        {mode === "live" && ballAway ? (
          <button type="button" className="stage-control" onClick={() => stageRef.current?.resetBall()} aria-label={labels.resetBall} title={labels.resetBall}>
            <RotateCcw aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        {mode === "live" ? (
          <>
            <button
              type="button"
              className="stage-control"
              onClick={toggleMotion}
              aria-pressed={!motion}
              aria-label={motion ? labels.motionPause : labels.motionPlay}
              title={motion ? labels.motionPause : labels.motionPlay}
            >
              {motion ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
            </button>
            <button
              type="button"
              className="stage-control"
              onClick={toggleSound}
              aria-pressed={sound}
              aria-label={sound ? labels.soundOff : labels.soundOn}
              title={sound ? labels.soundOff : labels.soundOn}
            >
              {sound ? <Volume2 aria-hidden="true" className="size-4" /> : <VolumeX aria-hidden="true" className="size-4" />}
            </button>
          </>
        ) : null}
      </div>

      <div ref={scenesRef} className="stage-scenes">
        {children}
      </div>

      <div className="stage-layer">
        <div aria-hidden="true" className="stage-fallback" />
        <canvas ref={canvasRef} aria-hidden="true" className="stage-canvas" />
        <div aria-hidden="true" className="stage-grade" />
        <button
          ref={handleRef}
          type="button"
          className="stage-ball"
          data-on="false"
          aria-label={labels.kick}
          onPointerDown={onBallDown}
          onPointerMove={onBallMove}
          onPointerUp={onBallUp}
          onPointerCancel={() => (flick.current = [])}
          onClick={onBallClick}
        >
          {!kicked ? (
            <span aria-hidden="true" className="stage-ball-hint">
              {labels.kickHint}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

export type { MarkerSpec, PositionKey };
