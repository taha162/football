import { FILL_FRAMES, REVEALS_START, RISE_FRAMES, RISE_TIMING } from "./enter-script";
import { prefersReducedMotion } from "./scroll";

/** Marked content: `.reveal` elements, and every child of a `.reveal-children` element. */
const ITEMS = ".reveal, .reveal-children > *";

/**
 * Marked content rises into place:
 * - on screen when a page arrives (a navigation, or results replacing
 *   others): straight away, one after another in reading order;
 * - below the fold: the first time it is scrolled into view.
 * The first page load is handled before hydration by ENTER_SCRIPT, which
 * stops watching for streamed sections once this takes over; marked content
 * inside a `.reveal` moves with it. Capacity bars inside fill up after their
 * card.
 *
 * Everything runs on Web Animations, never on attributes: server-rendered
 * content may still be waiting for hydration when it is first seen here.
 */
export function startReveals(): () => void {
  if (prefersReducedMotion()) return () => undefined;

  const seen = new WeakSet<Element>();
  const waiting = new Map<HTMLElement, Animation>(); // hidden until scrolled to

  const rise = (els: HTMLElement[]) => {
    els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    els.forEach((el, i) => {
      waiting.get(el)?.cancel();
      waiting.delete(el);
      const delay = Math.min(i, RISE_TIMING.maxStagger) * RISE_TIMING.stagger;
      el.animate(RISE_FRAMES, { duration: RISE_TIMING.duration, delay, easing: RISE_TIMING.easing, fill: "backwards" });
      el.querySelectorAll(".meter-fill").forEach((bar) =>
        bar.animate(FILL_FRAMES, { duration: 1100, delay: delay + 250, easing: RISE_TIMING.easing, fill: "backwards" }),
      );
    });
  };

  const io = new IntersectionObserver(
    (entries) => {
      const arrived = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
      arrived.forEach((el) => io.unobserve(el));
      if (arrived.length) rise(arrived);
    },
    { rootMargin: "0px 0px -6% 0px" },
  );

  const scan = (first: boolean) => {
    for (const [el, hold] of waiting) {
      if (el.isConnected) continue;
      hold.cancel();
      waiting.delete(el);
      io.unobserve(el);
    }
    const now: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>(ITEMS).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (el.parentElement?.closest(".reveal")) return;
      const r = el.getBoundingClientRect();
      // Anything already showing counts as on screen, so nothing visible is ever hidden again.
      const onScreen = (r.width > 0 || r.height > 0) && r.bottom > 0 && r.top < window.innerHeight;
      if (!onScreen) {
        waiting.set(el, el.animate([{ opacity: 0 }], { duration: 0, fill: "forwards" }));
        io.observe(el);
      } else if (!first) {
        now.push(el);
      }
    });
    if (now.length) rise(now);
  };

  // The entrance finishes what it has started, so what is on screen now has been handled.
  document.dispatchEvent(new Event(REVEALS_START));
  scan(true);
  // New content is checked before it is first painted (mutations → next frame).
  let frame = 0;
  const mo = new MutationObserver(() => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      scan(false);
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Paper has no scrolling: print everything.
  const showAll = () => {
    waiting.forEach((hold) => hold.cancel());
    waiting.clear();
    io.disconnect();
  };
  window.addEventListener("beforeprint", showAll);

  return () => {
    window.removeEventListener("beforeprint", showAll);
    mo.disconnect();
    cancelAnimationFrame(frame);
    showAll();
  };
}
