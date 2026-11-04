"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { NOTIFICATIONS_SEEN } from "@/components/notifications/seen-list";

/**
 * The header's messages and notifications buttons with their unread count.
 * The count comes from the server; the bell's clears as soon as the
 * notifications page has read them, without waiting for the page to reload.
 */
export function CountLink({
  href,
  label,
  count,
  children,
  className,
}: {
  href: "/messages" | "/notifications";
  label: string;
  count: number;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("nav");
  // A new count from the server replaces a cleared one.
  const [state, setState] = useState({ count, cleared: false });
  if (state.count !== count) setState({ count, cleared: false });
  const shown = state.cleared ? 0 : count;

  useEffect(() => {
    if (href !== "/notifications") return;
    const clear = () => setState((s) => ({ ...s, cleared: true }));
    window.addEventListener(NOTIFICATIONS_SEEN, clear);
    return () => window.removeEventListener(NOTIFICATIONS_SEEN, clear);
  }, [href]);

  return (
    <LinkButton
      href={href}
      className={buttonClass("ghost", "sm", `relative px-2.5 ${className ?? ""}`)}
      aria-label={shown > 0 ? t("withUnread", { label, count: shown }) : label}
    >
      {children}
      {shown > 0 ? (
        <span key={shown} aria-hidden="true" className="badge-pop num absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-5 text-accent-ink">
          {shown > 99 ? "99+" : shown}
        </span>
      ) : null}
    </LinkButton>
  );
}
