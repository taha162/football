import type Lenis from "lenis";

let lenis: Lenis | null = null;

/** The window's smooth-scroll controller (set by MotionRoot once the page is interactive). */
export const getLenis = () => lenis;
export const setLenis = (instance: Lenis | null) => {
  lenis = instance;
};

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Glides an element into comfortable view (about a third from the top) unless it already is. */
export function bringIntoView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.top >= 80 && r.bottom <= window.innerHeight - 80) return;
  const reduced = prefersReducedMotion();
  if (lenis && !reduced) lenis.scrollTo(el, { offset: -Math.round(window.innerHeight / 3) });
  else el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}

/** A short horizontal shake: "this needs another look". */
export function shake(el: HTMLElement) {
  if (prefersReducedMotion()) return;
  el.animate(
    [{ translate: "0" }, { translate: "-6px 0" }, { translate: "5px 0" }, { translate: "-3px 0" }, { translate: "2px 0" }, { translate: "0" }],
    { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}
