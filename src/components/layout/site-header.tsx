import { Bell, MessageCircle, Plus, ShieldCheck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { CurrentUser } from "@/lib/auth";
import { publicStorageUrl } from "@/lib/storage";
import { getUnreadCounts } from "@/server/reference";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { Logo } from "./logo";
import { LocaleSwitcher } from "./locale-switcher";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";

export async function SiteHeader({ user }: { user: CurrentUser | null }) {
  const t = await getTranslations("nav");
  const locale = await getLocale();
  const counts = user ? await getUnreadCounts() : { notifications: 0, messages: 0 };

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="shrink-0 rounded-lg" aria-label={t("home")}>
          <Logo />
        </Link>
        <nav aria-label={t("primary")} className="hidden flex-1 md:block">
          <NavLinks
            items={[
              { href: "/matches", label: t("matches") },
              { href: "/teams", label: t("teams") },
              { href: "/venues", label: t("venues") },
              { href: "/tournaments", label: t("tournaments") },
            ]}
          />
        </nav>
        <div className="ms-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
          <LocaleSwitcher />
          {user ? (
            <>
              <Link href="/matches/new" className={buttonClass("primary", "sm", "hidden md:inline-flex")}>
                <Plus aria-hidden="true" className="size-4" />
                {t("createMatch")}
              </Link>
              {user.isModerator ? (
                <Link href="/admin" className={buttonClass("ghost", "sm", "hidden md:inline-flex")} aria-label={t("admin")}>
                  <ShieldCheck aria-hidden="true" className="size-5" />
                </Link>
              ) : null}
              <CountLink href="/messages" label={t("messages")} count={counts.messages} className="hidden md:inline-flex">
                <MessageCircle aria-hidden="true" className="size-5" />
              </CountLink>
              <CountLink href="/notifications" label={t("notifications")} count={counts.notifications}>
                <Bell aria-hidden="true" className="size-5" />
              </CountLink>
              <UserMenu
                name={user.profile.display_name}
                avatar={<Avatar src={publicStorageUrl("avatars", user.profile.avatar_path)} name={user.profile.display_name} size={32} />}
                isModerator={user.isModerator}
                locale={locale}
              />
            </>
          ) : (
            <>
              <Link href="/sign-in" className={buttonClass("ghost", "sm")}>
                {t("signIn")}
              </Link>
              <Link href="/sign-up" className={buttonClass("primary", "sm")}>
                {t("signUp")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

async function CountLink({
  href,
  label,
  count,
  children,
  className,
}: {
  href: "/messages" | "/notifications";
  label: string;
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  const t = await getTranslations("nav");
  const accessible = count > 0 ? t("withUnread", { label, count }) : label;
  return (
    <Link href={href} className={buttonClass("ghost", "sm", `relative px-2.5 ${className ?? ""}`)} aria-label={accessible}>
      {children}
      {count > 0 ? (
        <span aria-hidden="true" className="num absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-5 text-accent-ink">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
