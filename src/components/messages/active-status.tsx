"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { isActiveNow, PRESENCE_BEAT_MS } from "@/lib/presence";
import { getBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

/** Nobody has touched the page for this long: stop asking until they're back (as live-refresh.tsx). */
const IDLE_MS = 3 * 60_000;

/**
 * «نشط الآن» or «نشط قبل 5 دقائق», for someone the member may know it about
 * (migration 0049: friends and people they talk with, unless hidden);
 * `fallback` when it isn't known.
 * - The first render uses the server's clock (`at`), so it matches the page the
 *   server sent; then the browser's, every minute.
 * - Asked again every minute while the page is seen and used, and only about
 *   someone whose time was known; a fresh page from the server (live refresh)
 *   brings a fresh time, which wins.
 */
export function ActiveStatus({
  userId,
  initial,
  at,
  fallback = null,
  className,
}: {
  userId: string;
  /** When they were last active, as the server read it (null: not known). */
  initial: string | null;
  /** The server's clock (ms) when it read it. */
  at: number;
  fallback?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("messages");
  const format = useFormatter();
  const [state, setState] = useState({ initial, at, lastSeen: initial, now: at });
  if (state.initial !== initial || state.at !== at) setState({ initial, at, lastSeen: initial, now: at });
  const known = initial !== null;

  useEffect(() => {
    let active = Date.now();
    const touched = () => {
      active = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, touched, { passive: true });
    const tick = async () => {
      const time = Date.now();
      setState((s) => ({ ...s, now: time }));
      if (!known || document.visibilityState !== "visible" || time - active > IDLE_MS) return;
      const { data, error } = await getBrowserClient().rpc("last_seen", { p_user_ids: [userId] });
      if (error) return;
      // No row: they hid it, or one of them blocked the other.
      const row = (data ?? []).find((r) => r.user_id === userId);
      setState((s) => ({ ...s, lastSeen: row?.last_seen_at ?? null, now: Date.now() }));
    };
    const timer = setInterval(() => void tick(), PRESENCE_BEAT_MS);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, touched);
    };
  }, [userId, known]);

  const { lastSeen, now } = state;
  if (!lastSeen) return <>{fallback}</>;
  const online = isActiveNow(lastSeen, now);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-testid="active-status" data-online={online || undefined}>
      {online ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" /> : null}
      {online ? t("activeNow") : t("activeAgo", { ago: format.relativeTime(new Date(lastSeen), now) })}
    </span>
  );
}
