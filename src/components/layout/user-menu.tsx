"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Building2, CalendarCheck, LayoutDashboard, LogOut, Settings, ShieldCheck, Trophy, UserRound, Users, UsersRound, type LucideIcon } from "lucide-react";
import { usePathname } from "@/i18n/navigation";
import { signOutAction } from "@/server/auth";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { LinkButton, type Href } from "@/components/ui/link-button";

const itemClass =
  "ripple flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-start text-sm text-ink outline-none transition-[background-color,translate] hover:bg-surface-3 hover:translate-x-[var(--nudge)] focus-visible:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent/60";

function Item({ href, icon: Icon, children }: { href: Href; icon: LucideIcon; children: ReactNode }) {
  return (
    <LinkButton role="menuitem" tabIndex={-1} className={itemClass} href={href}>
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
      {children}
    </LinkButton>
  );
}

const Divider = () => <div role="separator" className="my-1 h-px bg-line" />;

/**
 * The round picture at the end of the header that opens the account menu: who
 * is signed in (picture, name, number or e-mail), the member's own pages, the
 * pages they manage, and signing out. A button with aria-haspopup="menu":
 * Enter, Space or ↓ open it on the first item, ↑ on the last; ↑ ↓ Home End
 * move; Escape closes it and returns to the picture; Tab, a click elsewhere or
 * going to another page close it. Kept short: management pages appear only
 * for people who manage something, and what the bottom bar or the dashboard
 * already offers isn't repeated here.
 */
export function UserMenu({
  name,
  username = null,
  avatarSrc,
  contact,
  isModerator,
  managesVenues,
  organizesTournaments,
}: {
  name: string;
  /** Their @username, under their name (null before migration 0041). */
  username?: string | null;
  avatarSrc: string | null;
  /** The member's number or e-mail, under their name. */
  contact: string | null;
  isModerator: boolean;
  managesVenues: boolean;
  organizesTournaments: boolean;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  // Which item takes the focus when the menu opens: the first, or the last (↑ on the picture).
  const [focusOn, setFocusOn] = useState<"first" | "last">("first");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const menuId = useId();
  const triggerId = useId();

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // Going to another page closes it (derived from the path, not an effect).
  const [openedOn, setOpenedOn] = useState(pathname);
  if (openedOn !== pathname) {
    setOpenedOn(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusOn === "last" ? list.at(-1) : list[0])?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, focusOn]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusOn(e.key === "ArrowUp" ? "last" : "first");
      setOpen(true);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") setOpen(false);
  };

  const manages = managesVenues || organizesTournaments || isModerator;

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className="menu-trigger flex size-10 items-center justify-center rounded-full"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("accountMenu", { name })}
        onClick={() => {
          setFocusOn("first");
          setOpen((o) => !o);
        }}
        onKeyDown={onTriggerKey}
      >
        <Avatar src={avatarSrc} name={name} size={32} />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          data-open=""
          onKeyDown={onMenuKey}
          className="menu-panel absolute end-0 top-12 z-50 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-2xl"
        >
          <div role="none" className="mb-1 flex items-center gap-3 border-b border-line px-2.5 pb-3 pt-2">
            <Avatar src={avatarSrc} name={name} size={40} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-ink">{name}</span>
              {username ? (
                <span className="truncate text-xs font-medium text-accent" data-testid="account-username">
                  <bdi dir="ltr">@{username}</bdi>
                </span>
              ) : null}
              {contact ? (
                <span className="truncate text-xs text-muted" data-testid="account-contact">
                  <bdi dir="ltr">{contact}</bdi>
                </span>
              ) : null}
            </div>
          </div>
          <Item href="/dashboard" icon={LayoutDashboard}>{t("dashboard")}</Item>
          <Item href="/profile" icon={UserRound}>{t("profile")}</Item>
          <Item href="/friends" icon={UsersRound}>{t("friends")}</Item>
          <Item href="/my/teams" icon={Users}>{t("myTeams")}</Item>
          <Item href="/my/bookings" icon={CalendarCheck}>{t("myBookings")}</Item>
          <Item href="/settings" icon={Settings}>{t("settings")}</Item>
          {manages ? (
            <>
              <Divider />
              {managesVenues ? <Item href="/manage/venues" icon={Building2}>{t("venueDashboard")}</Item> : null}
              {organizesTournaments ? <Item href="/manage/tournaments" icon={Trophy}>{t("tournamentDashboard")}</Item> : null}
              {isModerator ? <Item href="/admin" icon={ShieldCheck}>{t("admin")}</Item> : null}
            </>
          ) : null}
          <Divider />
          <form action={signOutAction} role="none">
            <button type="submit" role="menuitem" tabIndex={-1} className={cn(itemClass, "text-danger")}>
              <LogOut aria-hidden="true" className="size-4 shrink-0" />
              {t("signOut")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
