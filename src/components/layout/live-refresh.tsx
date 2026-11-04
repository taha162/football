"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient, getRealtimeClient } from "@/lib/supabase/client";

/** How often an open page checks for news when nothing has arrived live. */
const POLL_MS = 30_000;
/** Events close together make one refresh. */
const SETTLE_MS = 1_200;
/** Nobody has touched the page for this long: stop checking until they're back. */
const IDLE_MS = 3 * 60_000;

/** True while the person is typing somewhere: a refresh then waits. */
function typing() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Keeps the open page up to date without reloading it. The page's data is
 * fetched again (router.refresh: server components re-render, what the
 * person typed and opened stays) when:
 * - something arrives for them: a notification (live, through Supabase
 *   Realtime, only their own rows), or, on the messages pages, a message in one
 *   of their conversations (RLS decides what reaches them; elsewhere the header's
 *   count catches up on the next check, so Realtime isn't asked to test every
 *   message against every visitor);
 * - they come back to the tab or the connection returns;
 * - and every 30 seconds while the tab is visible and in use, for changes that
 *   don't notify them (another player joining a match, a time being booked…).
 *   A page left untouched for 3 minutes stops checking until they're back.
 * A refresh waits while they're typing.
 */
export function LiveRefresh({ userId }: { userId: string }) {
  const router = useRouter();
  const onMessages = /\/messages(\/|$)/.test(usePathname() ?? "");

  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | null = null;
    let last = Date.now();
    let active = Date.now();
    const touched = () => {
      active = Date.now();
    };
    const activity = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of activity) window.addEventListener(e, touched, { passive: true });
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (typing()) {
        // Try again once they've paused.
        schedule(5_000);
        return;
      }
      last = Date.now();
      router.refresh();
    };
    const schedule = (ms = SETTLE_MS) => {
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        refresh();
      }, ms);
    };

    const poll = setInterval(() => {
      if (Date.now() - active > IDLE_MS) return;
      if (Date.now() - last >= POLL_MS - 1_000) refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      touched();
      if (Date.now() - last > 5_000) schedule(300);
    };
    const onOnline = () => schedule(300);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    let channel: RealtimeChannel | null = null;
    let closed = false;
    // Joined as the person (see getRealtimeClient), so only their own rows arrive.
    void getRealtimeClient().then((supabase) => {
      if (closed) return;
      let live = supabase
        .channel(`live:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => schedule());
      if (onMessages) live = live.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => schedule());
      channel = live.subscribe();
    });

    return () => {
      closed = true;
      if (settle) clearTimeout(settle);
      clearInterval(poll);
      for (const e of activity) window.removeEventListener(e, touched);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (channel) void getBrowserClient().removeChannel(channel);
    };
  }, [router, userId, onMessages]);

  return null;
}
