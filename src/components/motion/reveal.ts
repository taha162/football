import { prefersReducedMotion } from "./scroll";

/** Marked content: `.reveal` elements, and every child of a `.reveal-children` element. */
const ITEMS = ".reveal, .reveal-children > *";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const RISE: Keyframe[] = [
  { opacity: 0, transform: "translate3d(0, 18px, 0) scale(0.985)" },
  { opacity: 1, transform: "none" },
];

/**
 * Marked content rises into place:
 * - below the fold, the first time it is scrolled into view;
 * - added later while on screen (new results, a new item), straight away.
 * What is on screen when a page arrives is left alone (the page transition
 * already moves it), and so is marked content inside a `.reveal`. Several
 * arriving together follow each other in reading order.
 *
 * Everything runs on Web Animations, never on attributes: server-rendered
 * content may still be waiting for hydration when it is first seen here.
 */
export function startReveals(pageArriving: () => boolean): () => void {
  if (prefersReducedMotion()) return () => undefined;

  const seen = new WeakSet<Element>();
  const waiting = new Map<HTMLElement, Animation>(); // hidden until scrolled to

  const rise = (els: HTMLElement[]) => {
    els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    els.forEach((el, i) => {
      waiting.get(el)?.cancel();
      waiting.delete(el);
      el.animate(RISE, { duration: 700, delay: Math.min(i, 6) * 70, easing: EASE_OUT, fill: "backwards" });
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
      const onScreen = (r.width > 0 || r.height > 0) && r.bottom > 0 && r.top < window.innerHeight * 0.94;
      if (!onScreen) {
        waiting.set(el, el.animate([{ opacity: 0 }], { duration: 0, fill: "forwards" }));
        io.observe(el);
      } else if (!first && !pageArriving()) {
        now.push(el);
      }
    });
    if (now.length) rise(now);
  };

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
