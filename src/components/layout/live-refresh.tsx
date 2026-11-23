"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient, getRealtimeClient } from "@/lib/supabase/client";

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
 *   Realtime, only their own rows). Messages are watched where they show: the
 *   list of conversations listens to its own conversations
 *   (messages/list-live.tsx) and an open conversation to itself (thread.tsx),
 *   never to every message on the platform, which Realtime would have to test
 *   against every person listening;
 * - they come back to the tab or the connection returns;
 * - and every `checkSeconds` (90 by default; the platform setting
 *   live.check_seconds), give or take a tenth so that everyone's pages don't
 *   check at the same moment, while the tab is visible and in use, for changes
 *   that don't notify them (another player joining a match, a time being
 *   booked…). A page left untouched for 3 minutes stops checking until they're
 *   back.
 * A refresh waits while they're typing.
 */
export function LiveRefresh({ userId, checkSeconds = 90 }: { userId: string; checkSeconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Spread over ±10%: pages opened together (after a deploy, at kick-off time) don't all check at once.
    const POLL_MS = Math.round(checkSeconds * 1000 * (0.9 + Math.random() * 0.2));
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
    void getRealtimeClient(userId).then((supabase) => {
      if (closed) return;
      // Joining the channel isn't listening yet: database changes flow once Realtime says "Subscribed
      // to PostgreSQL", which after a cold start can take seconds. The page says so then
      // (html[data-live="on"]), and if it took a while, catches up on what came in meanwhile.
      let joinedAt = 0;
      const live = supabase
        .channel(`live:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => schedule())
        .on("system", {}, (payload: { extension?: string; status?: string }) => {
          if (payload?.extension !== "postgres_changes" || payload.status !== "ok") return;
          document.documentElement.dataset.live = "on";
          if (joinedAt && Date.now() - joinedAt > 1_000) schedule(300);
        });
      channel = live.subscribe((status) => {
        if (status === "SUBSCRIBED") joinedAt = Date.now();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") delete document.documentElement.dataset.live;
      });
    });

    return () => {
      closed = true;
      if (settle) clearTimeout(settle);
      clearInterval(poll);
      for (const e of activity) window.removeEventListener(e, touched);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (channel) void getBrowserClient().removeChannel(channel);
      delete document.documentElement.dataset.live;
    };
  }, [router, userId, checkSeconds]);

  return null;
}
