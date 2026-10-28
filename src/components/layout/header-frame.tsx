"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

/**
 * The site header's outer frame. On the home page it floats transparently over
 * the cinematic hero and becomes solid once the visitor scrolls past the top;
 * everywhere else it is the regular sticky bar.
 */
export function HeaderFrame({ children }: { children: ReactNode }) {
  const isHome = usePathname() === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isHome) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHome]);

  const overlay = isHome && !scrolled;
  return (
    <header
      data-overlay={overlay || undefined}
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,border-color] duration-500",
        overlay
          ? "header-intro border-transparent bg-transparent"
          : "border-line/70 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70",
      )}
    >
      {children}
    </header>
  );
}
