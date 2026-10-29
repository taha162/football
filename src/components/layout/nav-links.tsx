"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { LinkButton } from "@/components/ui/link-button";

type Href = "/matches" | "/teams" | "/venues" | "/tournaments";

/**
 * Primary navigation. A highlight glides to whichever item the pointer is
 * over, and the current section is underlined (globals.css: nav-glide,
 * nav-link). Without script each item lights up on its own.
 */
export function NavLinks({ items }: { items: { href: Href; label: string }[] }) {
  const pathname = usePathname();
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const place = (li: HTMLElement) => {
      el.style.setProperty("--pill-x", `${li.offsetLeft}px`);
      el.style.setProperty("--pill-w", `${li.offsetWidth}px`);
    };
    const onOver = (e: PointerEvent) => {
      const li = e.target instanceof Element ? e.target.closest("li") : null;
      if (e.pointerType === "touch" || !li || !el.contains(li)) return;
      place(li);
      if ("hover" in el.dataset) return; // already showing: the change above glides
      void el.offsetWidth; // coming in from outside: appear in place, then fade in
      el.dataset.hover = "";
    };
    const onLeave = () => delete el.dataset.hover;
    el.dataset.ready = "";
    el.addEventListener("pointerover", onOver);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerover", onOver);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={frame} className="nav-glide">
      <span aria-hidden="true" className="nav-glide-pill" />
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <LinkButton
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("nav-link inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium", active ? "text-ink" : "text-muted hover:text-ink")}
              >
                {item.label}
              </LinkButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
