"use client";

import { Suspense, useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { CursorBall } from "./cursor-ball";
import { NavProgress } from "./nav-progress";
import { startPointerFx } from "./pointer-fx";
import { startReveals } from "./reveal";
import { getLenis, setLenis } from "./scroll";

/**
 * Site-wide motion, mounted once in the root layout after the page content:
 * smooth wheel scrolling, content rising into view, the pointer effects
 * (floodlit, tilting cards; magnetic buttons; ripples), the football cursor
 * and the navigation progress line. Lenis honours prefers-reduced-motion by
 * itself (no smoothing); everything else then stays off.
 */
export function MotionRoot() {
  const pathname = usePathname();

  // Runs after the router has scrolled the new page into place (its layout
  // effects come first in the tree): a wheel glide still running from the
  // previous page must not pull the new one away from there.
  useLayoutEffect(() => {
    const lenis = getLenis();
    if (lenis?.isScrolling === "smooth") lenis.scrollTo(window.scrollY, { immediate: true, force: true });
  }, [pathname]);

  useEffect(() => {
    const lenis = new Lenis({ autoRaf: true, allowNestedScroll: true, stopInertiaOnNavigate: true });
    setLenis(lenis);
    const stopReveals = startReveals();
    const stopPointerFx = startPointerFx();

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
      stopPointerFx();
      stopReveals();
      setLenis(null);
      lenis.destroy();
    };
  }, []);

  return (
    <>
      <CursorBall />
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
    </>
  );
}
