"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

/**
 * The site header's outer frame. On the home page it floats transparently over
 * the cinematic hero and becomes solid once the visitor scrolls past the top;
 * everywhere it gains a soft shadow once the page scrolls under it. It is
 * named for view transitions, so it holds still while pages change below it.
 */
export function HeaderFrame({ children }: { children: ReactNode }) {
  const isHome = usePathname() === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const threshold = isHome ? 24 : 4;
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHome]);

  const overlay = isHome && !scrolled;
  return (
    <header
      data-overlay={overlay || undefined}
      data-scrolled={(scrolled && !overlay) || undefined}
      style={{ viewTransitionName: "site-header" }}
      className={cn(
        "site-header sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-500",
        overlay
          ? "header-intro border-transparent bg-transparent"
          : "border-line/70 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70",
      )}
    >
      {children}
    </header>
  );
}
