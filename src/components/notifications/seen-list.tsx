"use client";

import { useEffect, useState, type ReactNode } from "react";
import { markNotificationsSeen } from "@/server/notifications";

/** Tells the header's bell that the notifications were read (see CountLink). */
export const NOTIFICATIONS_SEEN = "malab:notifications-seen";

/**
 * The notifications list. Opening it marks the unread ones read straight away,
 * with no button to press: the bell's count clears, and the "new" marks fade
 * after a moment so what was new can still be spotted.
 */
export function SeenList({ unreadIds, className, children }: { unreadIds: string[]; className?: string; children: ReactNode }) {
  const [seen, setSeen] = useState(false);
  const key = unreadIds.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    void markNotificationsSeen(key.split(",")).then((done) => {
      if (!done || !live) return;
      window.dispatchEvent(new Event(NOTIFICATIONS_SEEN));
      setSeen(true);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return (
    <ul className={className} data-seen={seen || undefined}>
      {children}
    </ul>
  );
}
