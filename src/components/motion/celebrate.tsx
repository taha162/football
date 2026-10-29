"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "./scroll";

/** Set when this tab sends an action that may end in a celebration. */
let armed: { key: string; at: number } | null = null;
const ARMED_FOR_MS = 20_000;

export function armCelebration(key: string) {
  armed = { key, at: Date.now() };
}

/**
 * Wraps a confirmation rendered from server state (e.g. "You're in"). When
 * this tab sent the matching action moments ago, flecks of lime and white go
 * up from it, once. Arriving on the same state any other way does nothing.
 */
export function Celebration({ on, children }: { on: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!armed || armed.key !== on || Date.now() - armed.at > ARMED_FOR_MS) return;
    armed = null;
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + Math.min(r.height / 2, 32));
  }, [on]);
  return <div ref={ref}>{children}</div>;
}

const COLORS = ["#b8f23f", "#e9f1eb", "#d6ff7a", "#4ade80", "#ffffff"];
const GRAVITY = 1300; // px/s², screen y grows downwards
const DRAG = 2; // 1/s

function burst(x: number, y: number) {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;z-index:80;overflow:hidden;pointer-events:none";
  document.body.append(layer);
  let longest = 0;
  for (let i = 0; i < 28; i++) {
    const fleck = document.createElement("span");
    const w = 5 + Math.random() * 5;
    const h = Math.random() < 0.55 ? w * 0.45 : w;
    fleck.style.cssText = `position:absolute;left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px;border-radius:${h === w ? "50%" : "1px"};background:${COLORS[i % COLORS.length]}`;
    layer.append(fleck);
    // Thrown up in a fan, slowed by the air, pulled down, tumbling.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
    const speed = 550 + Math.random() * 400;
    const [vx, vy] = [Math.cos(angle) * speed, Math.sin(angle) * speed];
    const spin = (Math.random() - 0.5) * 1100;
    const flip = 360 + Math.random() * 900;
    const duration = 1100 + Math.random() * 500;
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = (k / 12) * (duration / 1000);
      // Linear drag: v' = g - k·v, solved exactly.
      const slow = (1 - Math.exp(-DRAG * t)) / DRAG;
      const dx = vx * slow;
      const dy = (GRAVITY / DRAG) * t + (vy - GRAVITY / DRAG) * slow;
      frames.push({
        transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${(spin * t).toFixed(0)}deg) rotateY(${(flip * t).toFixed(0)}deg)`,
        opacity: k < 8 ? 1 : 1 - (k - 8) / 4,
      });
    }
    fleck.animate(frames, { duration, easing: "linear", fill: "forwards" });
    longest = Math.max(longest, duration);
  }
  window.setTimeout(() => layer.remove(), longest + 100);
}
