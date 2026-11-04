"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient, getRealtimeClient } from "@/lib/supabase/client";

/** How often an open page checks for news when nothing has arrived live. */
const POLL_MS = 30_000;
/** Events close together make one refresh. */
const SETTLE_MS = 1_200;

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
 * - something arrives for them: a notification, or a message in one of their
 *   conversations (live, through Supabase Realtime; RLS decides what reaches them);
 * - they come back to the tab or the connection returns;
 * - and every 30 seconds while the tab is visible, for changes that don't
 *   notify them (another player joining a match, a time being booked…).
 * A refresh waits while they're typing.
 */
export function LiveRefresh({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | null = null;
    let last = Date.now();
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
      if (Date.now() - last >= POLL_MS - 1_000) refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5_000) schedule(300);
    };
    const onOnline = () => schedule(300);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    let channel: RealtimeChannel | null = null;
    let closed = false;
    // Joined as the person (see getRealtimeClient), so only their own rows arrive.
    void getRealtimeClient().then((supabase) => {
      if (closed) return;
      channel = supabase
        .channel(`live:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => schedule())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => schedule())
        .subscribe();
    });

    return () => {
      closed = true;
      if (settle) clearTimeout(settle);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (channel) void getBrowserClient().removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
