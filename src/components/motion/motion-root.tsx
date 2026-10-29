"use client";

import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { NavProgress } from "./nav-progress";
import { startReveals } from "./reveal";
import { getLenis, setLenis } from "./scroll";
import { startSpotlight } from "./spotlight";

/** How long after a navigation new on-screen content counts as part of the arriving page. */
const ARRIVAL_MS = 700;

/**
 * Site-wide motion, mounted once in the root layout after the page content:
 * smooth wheel scrolling, scroll reveals, floodlit cards and the navigation
 * progress line. Lenis honours prefers-reduced-motion by itself (no
 * smoothing); the reveals then stay off.
 */
export function MotionRoot() {
  const pathname = usePathname();
  const navigatedAt = useRef(0);

  // Runs after the router has scrolled the new page into place (its layout
  // effects come first in the tree): a wheel glide still running from the
  // previous page must not pull the new one away from there.
  useLayoutEffect(() => {
    navigatedAt.current = performance.now();
    const lenis = getLenis();
    if (lenis?.isScrolling === "smooth") lenis.scrollTo(window.scrollY, { immediate: true, force: true });
  }, [pathname]);

  useEffect(() => {
    const lenis = new Lenis({ autoRaf: true, allowNestedScroll: true, stopInertiaOnNavigate: true });
    setLenis(lenis);
    const stopReveals = startReveals(() => performance.now() - navigatedAt.current < ARRIVAL_MS);
    const stopSpotlight = startSpotlight();

    // A swipe back the browser has already animated is not animated again.
    const root = document.documentElement;
    let settle = 0;
    const onPopState = (e: PopStateEvent) => {
      if (!(e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) return;
      root.dataset.uaTransition = "";
      clearTimeout(settle);
      settle = window.setTimeout(() => delete root.dataset.uaTransition, 1000);
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      clearTimeout(settle);
      stopSpotlight();
      stopReveals();
      setLenis(null);
      lenis.destroy();
    };
  }, []);

  return (
    <Suspense fallback={null}>
      <NavProgress />
    </Suspense>
  );
}
