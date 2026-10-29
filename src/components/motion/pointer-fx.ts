import { prefersReducedMotion } from "./scroll";

/**
 * Everything that answers the pointer, from one set of listeners:
 *
 * - mouse and pen: cards are lit from the pointer (--mx/--my) and tilt
 *   towards it (--tilt-x/--tilt-y); buttons are pulled a little towards it
 *   (--pull-x/--pull-y);
 * - every pointer, touch included: a ripple spreads from where a button,
 *   card or row is pressed, phone-bar icons bounce, and on phones a primary
 *   action gives a short haptic tick where the device supports it.
 *
 * Custom properties are written through held Web Animations, never the style
 * attribute: an element may not be hydrated yet when the pointer reaches it.
 */
const RIPPLE_HOSTS = ".btn, .ripple, .card-cover, .cta-primary";
const MAGNETIC = ".btn-lift, .cta-primary";
const TILT_DEG = 7;

const vars = new WeakMap<Element, { values: Record<string, string>; anim: Animation }>();
function setVars(el: Element, values: Record<string, string>) {
  const held = vars.get(el);
  if (held && held.anim.effect instanceof KeyframeEffect) {
    Object.assign(held.values, values);
    held.anim.effect.setKeyframes([held.values]);
    return;
  }
  const all = { ...values };
  vars.set(el, { values: all, anim: el.animate([all], { duration: 0, fill: "forwards" }) });
}

const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

function ripple(host: HTMLElement, x: number, y: number) {
  // Dark ink on the lime primary needs more strength to read than light ink on dark surfaces.
  const strength = host.matches(".btn-glow, .cta-primary") ? 0.42 : 0.26;
  const r = host.getBoundingClientRect();
  const px = x - r.left;
  const py = y - r.top;
  const radius = Math.hypot(Math.max(px, r.width - px), Math.max(py, r.height - py));
  host.animate(
    [
      { backgroundSize: "0px 0px", backgroundPosition: `${px}px ${py}px`, opacity: strength },
      { backgroundSize: `${radius * 2}px ${radius * 2}px`, backgroundPosition: `${px - radius}px ${py - radius}px`, opacity: 0 },
    ],
    { duration: 700, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::after" },
  );
}

export function startPointerFx(): () => void {
  if (prefersReducedMotion()) return () => undefined;

  let last: PointerEvent | null = null;
  let frame = 0;
  let tilted: HTMLElement | null = null;
  let pulled: HTMLElement | null = null;

  const release = () => {
    if (tilted) setVars(tilted, { "--tilt-x": "0deg", "--tilt-y": "0deg" });
    if (pulled) setVars(pulled, { "--pull-x": "0px", "--pull-y": "0px" });
    tilted = pulled = null;
  };

  const paint = () => {
    frame = 0;
    const e = last;
    const target = e?.target instanceof Element ? e.target : null;
    if (!e || !target) return;

    const card = target.closest<HTMLElement>(".spotlight, .card-hover");
    if (card) {
      const r = card.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const next: Record<string, string> = { "--mx": `${Math.round(x)}px`, "--my": `${Math.round(y)}px` };
      if (card.classList.contains("card-hover")) {
        // The card turns to face the pointer: the edge nearest it comes forward.
        next["--tilt-x"] = `${(clamp(y / r.height - 0.5, 0.5) * 2 * TILT_DEG).toFixed(2)}deg`;
        next["--tilt-y"] = `${(-clamp(x / r.width - 0.5, 0.5) * 2 * TILT_DEG).toFixed(2)}deg`;
      }
      setVars(card, next);
    }
    if (tilted && tilted !== card) setVars(tilted, { "--tilt-x": "0deg", "--tilt-y": "0deg" });
    tilted = card?.classList.contains("card-hover") ? card : null;

    const magnet = target.closest<HTMLElement>(MAGNETIC);
    if (magnet && !magnet.matches(":disabled, [aria-disabled='true']")) {
      const r = magnet.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      setVars(magnet, { "--pull-x": `${clamp(dx * 0.22, 8).toFixed(1)}px`, "--pull-y": `${clamp(dy * 0.3, 5).toFixed(1)}px` });
    }
    if (pulled && pulled !== magnet) setVars(pulled, { "--pull-x": "0px", "--pull-y": "0px" });
    pulled = magnet;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    last = e;
    frame ||= requestAnimationFrame(paint);
  };

  const onDown = (e: PointerEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    const host = target?.closest<HTMLElement>(RIPPLE_HOSTS);
    if (host && !host.matches(":disabled, [aria-disabled='true']")) ripple(host, e.clientX, e.clientY);
    const tab = target?.closest(".mnav-link");
    const icon = tab?.querySelector("svg");
    if (icon) {
      icon.animate([{ scale: "1" }, { scale: "0.78" }, { scale: "1.22" }, { scale: "1" }], { duration: 520, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
    }
    if (e.pointerType === "touch" && (host?.matches(".btn-glow, .cta-primary") || tab?.querySelector(".mnav-plus"))) {
      navigator.vibrate?.(8);
    }
  };

  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerdown", onDown, { passive: true });
  document.documentElement.addEventListener("pointerleave", release);
  return () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerdown", onDown);
    document.documentElement.removeEventListener("pointerleave", release);
    cancelAnimationFrame(frame);
    release();
  };
}
