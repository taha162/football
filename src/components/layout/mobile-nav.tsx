"use client";

import { CalendarSearch, Home, MapPinned, MessageCircle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { LinkButton } from "@/components/ui/link-button";

/**
 * Bottom navigation on small screens; the primary action sits in the middle.
 * The current tab lights a segment of the top line (globals.css: mnav-link);
 * the bar is named for view transitions, so it holds still while pages change.
 */
const BOOK_HREF = { pathname: "/venues", query: { bookable: "1" } };

export function MobileNav({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  // «+» in the middle books a pitch: the venues taking bookings, each opening its booking page.
  const items = [
    { href: signedIn ? "/dashboard" : "/", label: t("home"), icon: Home },
    { href: "/venues", label: t("venues"), icon: MapPinned },
    { href: BOOK_HREF, label: t("book"), icon: Plus, primary: true },
    { href: "/matches", label: t("matches"), icon: CalendarSearch },
    { href: signedIn ? "/messages" : "/sign-in", label: signedIn ? t("messages") : t("signIn"), icon: MessageCircle },
  ] as const;
  return (
    <nav aria-label={t("mobile")} style={{ viewTransitionName: "mobile-nav" }} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <li key={item.label}>
              <LinkButton
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("mnav-link ripple flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-accent" : "text-muted")}
              >
                {"primary" in item ? (
                  <span className="mnav-plus flex size-11 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg shadow-accent/20">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                ) : (
                  <Icon aria-hidden="true" className="size-5" />
                )}
                <span className={"primary" in item ? "sr-only" : undefined}>{item.label}</span>
              </LinkButton>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
