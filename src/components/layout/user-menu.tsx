"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { signOutAction } from "@/server/auth";

const itemClass = "flex min-h-10 w-full items-center rounded-lg px-3 text-start text-sm text-ink hover:bg-surface-3";

/** Disclosure menu built on <details>; closes on navigation and Escape. */
export function UserMenu({ name, avatar, isModerator }: { name: string; avatar: ReactNode; isModerator: boolean; locale: string }) {
  const t = useTranslations("nav");
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden" aria-label={t("accountMenu", { name })}>
        {avatar}
      </summary>
      <div className="absolute end-0 top-12 z-50 w-60 rounded-2xl border border-line bg-surface p-2 shadow-2xl">
        <p className="truncate px-3 py-2 text-sm font-semibold">{name}</p>
        <ul className="flex flex-col">
          <li><Link className={itemClass} href="/dashboard">{t("dashboard")}</Link></li>
          <li><Link className={itemClass} href="/profile">{t("profile")}</Link></li>
          <li><Link className={itemClass} href="/my/matches">{t("myMatches")}</Link></li>
          <li><Link className={itemClass} href="/my/teams">{t("myTeams")}</Link></li>
          <li><Link className={itemClass} href="/my/bookings">{t("myBookings")}</Link></li>
          <li><Link className={itemClass} href="/opponents">{t("opponents")}</Link></li>
          <li><Link className={itemClass} href="/manage/venues">{t("venueDashboard")}</Link></li>
          <li><Link className={itemClass} href="/manage/tournaments">{t("tournamentDashboard")}</Link></li>
          <li><Link className={itemClass} href="/messages">{t("messages")}</Link></li>
          <li><Link className={itemClass} href="/settings">{t("settings")}</Link></li>
          {isModerator ? <li><Link className={itemClass} href="/admin">{t("admin")}</Link></li> : null}
        </ul>
        <form action={signOutAction} className="mt-1 border-t border-line pt-1">
          <button type="submit" className={`${itemClass} text-danger`}>
            {t("signOut")}
          </button>
        </form>
      </div>
    </details>
  );
}
