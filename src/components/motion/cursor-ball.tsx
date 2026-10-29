"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./scroll";

/** Anything that reacts to a click: the ball rises and glows over it. */
const HOT = "a, button, summary, label, select, [role='link'], [role='button'], .card-cover, input[type='checkbox'], input[type='radio']";
/** Where the ball would get in the way: text entry, and the stadium's own ball. */
const AWAY = "input:not([type='checkbox'], [type='radio'], [type='submit'], [type='button']), textarea, [contenteditable='true'], .stage-ball";
const RADIUS = 11; // px, half the ball's size
const OFFSET = 20; // px: sits just below and after the arrow, off what is being pointed at

/**
 * A small football that follows the mouse on laptops and desktops. It trails
 * the pointer on a spring, rolls by the distance it travels, rises and glows
 * over anything clickable, and squashes when pressed. The normal cursor stays;
 * touch screens and reduced motion get no ball.
 */
export function CursorBall() {
  const root = useRef<HTMLDivElement>(null);
  const ball = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = root.current;
    const svg = ball.current;
    if (!el || !svg) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!fine.matches || prefersReducedMotion()) return;

    const pos = { x: -100, y: -100, vx: 0, vy: 0 };
    const goal = { x: -100, y: -100 };
    let angle = 0;
    let frame = 0;
    let lastT = 0;
    let shown = false;

    const step = (t: number) => {
      const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 1 / 60);
      lastT = t;
      // A slightly underdamped spring: it catches up quickly and settles with a little roll.
      const k = 260;
      const c = 2 * Math.sqrt(k) * 0.82;
      for (const [p, v, g] of [["x", "vx", "x"], ["y", "vy", "y"]] as const) {
        const a = k * (goal[g] - pos[p]) - c * pos[v];
        pos[v] += a * dt;
        pos[p] += pos[v] * dt;
      }
      // Rolling without slipping: the turn is the distance covered over the radius.
      angle += ((pos.vx + pos.vy * 0.35) * dt * 180) / (Math.PI * RADIUS);
      el.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`;
      svg.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      const moving = Math.abs(pos.vx) + Math.abs(pos.vy) > 2 || Math.abs(goal.x - pos.x) + Math.abs(goal.y - pos.y) > 0.5;
      frame = moving ? requestAnimationFrame(step) : 0;
      if (!moving) lastT = 0;
    };
    const wake = () => {
      frame ||= requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      goal.x = e.clientX + OFFSET;
      goal.y = e.clientY + OFFSET;
      if (!shown) {
        // Appear where the pointer is, not fly in from the last place it was seen.
        pos.x = goal.x;
        pos.y = goal.y;
        pos.vx = pos.vy = 0;
        shown = true;
      }
      const target = e.target instanceof Element ? e.target : null;
      el.toggleAttribute("data-on", !target?.closest(AWAY));
      el.toggleAttribute("data-hot", Boolean(target?.closest(HOT)));
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") el.setAttribute("data-down", "");
    };
    const onUp = () => {
      if (!el.hasAttribute("data-down")) return;
      el.removeAttribute("data-down");
      // A kick: a quick extra spin.
      pos.vx += 260;
      wake();
    };
    const onLeave = () => {
      el.removeAttribute("data-on");
      shown = false;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={root} className="cursor-ball" aria-hidden="true">
      <span>
        <svg ref={ball} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="#f4f7f2" stroke="#0a0e0b" strokeWidth="1" />
          <path d="M12 7.4l4.37 3.18-1.67 5.14H9.3l-1.67-5.14z" fill="#0a0e0b" />
          <path
            d="M12 7.4V1.6M16.37 10.58l5.5-1.8M14.7 15.72l3.4 4.7M9.3 15.72l-3.4 4.7M7.63 10.58l-5.5-1.8"
            fill="none"
            stroke="#0a0e0b"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path d="M9.6 1.4L12 3.2l2.4-1.8M20.9 6.1l-.6 2.9 2.4 1.6M21 16.8l-2.9.3-.8 2.8M6.6 19.9l-.8-2.8-2.9-.3M1.3 10.6 3.7 9l-.6-2.9" fill="none" stroke="#0a0e0b" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}
