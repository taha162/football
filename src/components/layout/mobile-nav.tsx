"use client";

import { CalendarSearch, Home, MessageCircle, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

/**
 * Bottom navigation on small screens; the primary action sits in the middle.
 * The current tab lights a segment of the top line (globals.css: mnav-link);
 * the bar is named for view transitions, so it holds still while pages change.
 */
export function MobileNav({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const items = [
    { href: signedIn ? "/dashboard" : "/", label: t("home"), icon: Home },
    { href: "/matches", label: t("matches"), icon: CalendarSearch },
    { href: "/matches/new", label: t("create"), icon: Plus, primary: true },
    { href: "/teams", label: t("teams"), icon: Users },
    { href: signedIn ? "/messages" : "/sign-in", label: signedIn ? t("messages") : t("signIn"), icon: MessageCircle },
  ] as const;
  return (
    <nav aria-label={t("mobile")} style={{ viewTransitionName: "mobile-nav" }} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("mnav-link flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-accent" : "text-muted")}
              >
                {"primary" in item ? (
                  <span className="mnav-plus flex size-11 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg shadow-accent/20">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                ) : (
                  <Icon aria-hidden="true" className="size-5" />
                )}
                <span className={"primary" in item ? "sr-only" : undefined}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
