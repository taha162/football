"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * A conversation on its own screen, as in a messaging app: its bar on top, the
 * messages filling the middle, the box to write in at the bottom. The site's
 * header and bottom bar step aside (lib/chat-path.ts), and the page behind
 * doesn't scroll.
 *
 * The screen follows the part of the page that is actually visible
 * (window.visualViewport). When the on-screen keyboard opens, it shrinks to
 * what is left above the keyboard, so the box to write in rises with it
 * instead of being covered, and the newest messages stay in view (thread.tsx).
 * iPhones don't resize the page for the keyboard: they move the visible part
 * of it instead, and the screen moves along (translateY by offsetTop).
 * `data-keyboard` while the keyboard is up: the home bar's safe area is under
 * the keyboard then, so the box drops that padding.
 *
 * Leaving it (back, or anywhere else) refreshes the page once: the site's
 * frame (the red dot on «الرسائل», the header's counts) doesn't reload between
 * pages by itself, and the conversation has just been read.
 */
export function ChatScreen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => () => router.refresh(), [router]);

  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    root.classList.add("chat-open");
    const vv = window.visualViewport;
    if (!el || !vv) return () => root.classList.remove("chat-open");
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.height = `${Math.round(vv.height)}px`;
        el.style.transform = vv.offsetTop > 0 ? `translateY(${Math.round(vv.offsetTop)}px)` : "";
        el.toggleAttribute("data-keyboard", window.innerHeight - vv.height > 120);
      });
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      root.classList.remove("chat-open");
    };
  }, []);

  return (
    <div ref={ref} data-testid="chat-screen" className="chat-screen fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-surface">
      {children}
    </div>
  );
}
